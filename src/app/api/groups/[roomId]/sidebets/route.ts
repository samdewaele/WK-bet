import { NextRequest, NextResponse } from "next/server";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { isTournamentStarted } from "@/lib/tournament-lock";
import { computeUberPotResults } from "@/lib/uber-pot";
import { requireRoomAccess } from "@/lib/room-auth";

type Params = { params: Promise<{ roomId: string }> };

async function resolveRoom(roomId: string, userId: string, role: string) {
  const room = await db.room.findUnique({ where: { id: roomId }, select: { creatorId: true } });
  if (!room) return null;
  return { isManager: room.creatorId === userId || role === "admin" };
}

export async function GET(_req: Request, { params }: Params) {
  const { roomId } = await params;
  const access = await requireRoomAccess(roomId);
  if (access instanceof NextResponse) return access;
  const { session } = access;
  const userId = session.user.id;

  const ctx = await resolveRoom(roomId, userId, session.user.role ?? "");
  const [locked, uber] = await Promise.all([
    isTournamentStarted(),
    computeUberPotResults(roomId),
  ]);

  const sideBets = await db.sideBet.findMany({
    where: { roomId },
    include: {
      proposedBy: { select: { id: true, name: true } },
      entries: {
        include: { user: { select: { id: true, name: true, image: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const bets = sideBets.map((sb) => {
      const myEntry = sb.entries.find((e) => e.userId === userId);
      // Reveal answers only after tournament starts or when settled
      const revealAll = locked || sb.status === "settled";
      const visibleEntries = revealAll ? sb.entries : myEntry ? [myEntry] : [];

      return {
        id: sb.id,
        title: sb.title,
        description: sb.description,
        status: sb.status,
        winnerEntryId: sb.winnerEntryId,
        // Money the winner won — only known once the bet is settled.
        prize: sb.status === "settled" ? (uber.byBet.get(sb.id)?.prize ?? 0) : null,
        createdAt: sb.createdAt.toISOString(),
        proposedByUserId: sb.proposedByUserId,
        proposedByName: sb.proposedBy?.name ?? null,
        entryCount: sb.entries.length,
        isManager: ctx?.isManager ?? false,
        entries: visibleEntries.map((e) => ({
          id: e.id,
          userId: e.userId,
          userName: e.user.name,
          userImage: e.user.image,
          answer: e.answer,
        })),
      };
  });

  return NextResponse.json({ bets, uberPot: uber.accumulatedUberPot });
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { roomId } = await params;
  const userId = session.user.id;

  if (await isTournamentStarted()) {
    return NextResponse.json({ error: "Tournament has started — Uber Pot Bets are locked" }, { status: 403 });
  }

  const ctx = await resolveRoom(roomId, userId, session.user.role ?? "");
  if (!ctx) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  const roomRow = await db.room.findUnique({ where: { id: roomId }, select: { uberBetsLocked: true, status: true } });
  if (roomRow && !["setup", "betting"].includes(roomRow.status)) {
    return NextResponse.json({ error: "Betting is closed — no new Uber Pot proposals" }, { status: 403 });
  }
  if (roomRow?.uberBetsLocked) {
    return NextResponse.json({ error: "Uber Pot bets are locked by the group admin" }, { status: 403 });
  }

  const membership = await db.roomMember.findUnique({
    where: { userId_roomId: { userId, roomId } },
  });
  if (!membership) return NextResponse.json({ error: "Not a member" }, { status: 403 });

  let body: { title?: string; description?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const title = body.title?.trim();
  if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });
  if (title.length > 200) return NextResponse.json({ error: "Title too long (max 200 chars)" }, { status: 400 });

  // Admin/creator proposals go straight to open; member proposals await approval
  const status = ctx.isManager ? "open" : "proposed";

  const sideBet = await db.sideBet.create({
    data: { roomId, proposedByUserId: userId, title, description: body.description?.trim() || null, status },
    include: { proposedBy: { select: { name: true } } },
  });

  return NextResponse.json({
    id: sideBet.id,
    title: sideBet.title,
    description: sideBet.description,
    status: sideBet.status,
    winnerEntryId: null,
    createdAt: sideBet.createdAt.toISOString(),
    proposedByUserId: sideBet.proposedByUserId,
    proposedByName: sideBet.proposedBy?.name ?? null,
    entryCount: 0,
    isManager: ctx.isManager,
    entries: [],
  });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { roomId } = await params;
  const userId = session.user.id;

  const ctx = await resolveRoom(roomId, userId, session.user.role ?? "");
  if (!ctx) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  let body: { sideBetId?: string; action?: "accept" | "reject" | "cancel" | "edit"; winnerEntryId?: string; title?: string; description?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.sideBetId) return NextResponse.json({ error: "sideBetId required" }, { status: 400 });

  const sideBet = await db.sideBet.findFirst({ where: { id: body.sideBetId, roomId } });
  if (!sideBet) return NextResponse.json({ error: "Uber Pot Bet not found" }, { status: 404 });

  if (body.action === "accept") {
    if (!ctx.isManager) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (sideBet.status !== "proposed") return NextResponse.json({ error: "Not a proposal" }, { status: 400 });
    const updated = await db.sideBet.update({ where: { id: body.sideBetId }, data: { status: "open" } });
    return NextResponse.json({ id: updated.id, status: updated.status });
  }

  if (body.action === "reject") {
    if (!ctx.isManager) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    await db.sideBetEntry.deleteMany({ where: { sideBetId: body.sideBetId } });
    await db.sideBet.delete({ where: { id: body.sideBetId } });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "cancel") {
    if (sideBet.status === "settled") {
      return NextResponse.json({ error: "Cannot cancel a settled bet" }, { status: 400 });
    }
    const locked = await isTournamentStarted();
    const roomRow = await db.room.findUnique({ where: { id: roomId }, select: { uberBetsLocked: true } });
    if (locked || roomRow?.uberBetsLocked) {
      return NextResponse.json({ error: "Uber Pot bets are locked" }, { status: 403 });
    }
    // Admin can cancel any bet; proposer can cancel their own bet
    if (!ctx.isManager && sideBet.proposedByUserId !== userId) {
      return NextResponse.json({ error: "You can only cancel your own bet" }, { status: 403 });
    }
    await db.sideBetEntry.deleteMany({ where: { sideBetId: body.sideBetId } });
    await db.sideBet.delete({ where: { id: body.sideBetId } });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "edit") {
    // Proposer or manager can edit title/description of any non-settled bet
    const canEdit = ctx.isManager || sideBet.proposedByUserId === userId;
    if (!canEdit) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (sideBet.status === "settled") return NextResponse.json({ error: "Cannot edit a settled bet" }, { status: 400 });
    const title = body.title?.trim();
    if (title !== undefined && !title) return NextResponse.json({ error: "Title cannot be empty" }, { status: 400 });
    const updated = await db.sideBet.update({
      where: { id: body.sideBetId },
      data: {
        ...(title ? { title } : {}),
        description: body.description !== undefined ? (body.description.trim() || null) : undefined,
      },
    });
    return NextResponse.json({ id: updated.id, title: updated.title, description: updated.description });
  }

  if (!ctx.isManager) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (body.winnerEntryId) {
    if (sideBet.status === "settled") return NextResponse.json({ error: "Already settled" }, { status: 400 });
    if (sideBet.status === "proposed") return NextResponse.json({ error: "Accept the proposal first" }, { status: 400 });
    const entry = await db.sideBetEntry.findUnique({ where: { id: body.winnerEntryId } });
    if (!entry || entry.sideBetId !== body.sideBetId) {
      return NextResponse.json({ error: "Winner entry not found" }, { status: 404 });
    }
    const updated = await db.sideBet.update({
      where: { id: body.sideBetId },
      data: { status: "settled", winnerEntryId: body.winnerEntryId },
    });
    return NextResponse.json({ id: updated.id, status: updated.status, winnerEntryId: updated.winnerEntryId });
  }

  return NextResponse.json({ error: "No valid action" }, { status: 400 });
}
