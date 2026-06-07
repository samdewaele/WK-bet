import { NextRequest, NextResponse } from "next/server";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { requireRoomAccess } from "@/lib/room-auth";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const access = await requireRoomAccess(roomId);
  if (access instanceof NextResponse) return access;
  const { session, isPlatformAdmin } = access;
  const userId = session.user.id;

  // Platform admin sees all bets in the room; members see only their own + open bets
  const bets = await db.p2PSideBet.findMany({
    where: isPlatformAdmin
      ? { roomId }
      : { roomId, OR: [{ proposerId: userId }, { acceptorId: userId }, { acceptorId: null }] },
    include: {
      proposer: { select: { id: true, name: true, image: true } },
      acceptor: { select: { id: true, name: true, image: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(
    bets.map((b) => ({
      id: b.id,
      proposerId: b.proposerId,
      proposerName: b.proposer.name,
      proposerImage: b.proposer.image,
      acceptorId: b.acceptorId,
      acceptorName: b.acceptor?.name ?? null,
      acceptorImage: b.acceptor?.image ?? null,
      amount: b.amount,
      description: b.description,
      status: b.status,
      winner: b.winner,
      createdAt: b.createdAt.toISOString(),
    }))
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { roomId } = await params;
  const userId = session.user.id;

  const membership = await db.roomMember.findUnique({
    where: { userId_roomId: { userId, roomId } },
  });
  if (!membership) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  let body: { amount?: number; description?: string; targetUserId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { amount, description, targetUserId } = body;

  if (typeof amount !== "number" || amount <= 0) {
    return NextResponse.json({ error: "Amount must be a positive number" }, { status: 400 });
  }

  const desc = description?.trim();
  if (!desc) {
    return NextResponse.json({ error: "Description is required" }, { status: 400 });
  }

  if (targetUserId) {
    if (targetUserId === userId) {
      return NextResponse.json({ error: "Cannot bet against yourself" }, { status: 400 });
    }
    const targetMembership = await db.roomMember.findUnique({
      where: { userId_roomId: { userId: targetUserId, roomId } },
    });
    if (!targetMembership) {
      return NextResponse.json({ error: "Target user is not a member" }, { status: 404 });
    }
  }

  const bet = await db.p2PSideBet.create({
    data: {
      roomId,
      proposerId: userId,
      acceptorId: targetUserId ?? null,
      amount,
      description: desc,
      status: "proposed",
    },
    include: {
      proposer: { select: { id: true, name: true, image: true } },
      acceptor: { select: { id: true, name: true, image: true } },
    },
  });

  return NextResponse.json({
    id: bet.id,
    proposerId: bet.proposerId,
    proposerName: bet.proposer.name,
    proposerImage: bet.proposer.image,
    acceptorId: bet.acceptorId,
    acceptorName: bet.acceptor?.name ?? null,
    acceptorImage: bet.acceptor?.image ?? null,
    amount: bet.amount,
    description: bet.description,
    status: bet.status,
    winner: bet.winner,
    createdAt: bet.createdAt.toISOString(),
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { roomId } = await params;
  const userId = session.user.id;

  const membership = await db.roomMember.findUnique({
    where: { userId_roomId: { userId, roomId } },
  });
  if (!membership) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  let body: { betId?: string; action?: string; winner?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { betId, action, winner } = body;

  if (!betId || !action) {
    return NextResponse.json({ error: "betId and action are required" }, { status: 400 });
  }

  const bet = await db.p2PSideBet.findFirst({
    where: { id: betId, roomId },
  });

  if (!bet) {
    return NextResponse.json({ error: "Bet not found" }, { status: 404 });
  }

  if (action === "accept") {
    if (bet.status !== "proposed") {
      return NextResponse.json({ error: "Bet is not in proposed state" }, { status: 400 });
    }
    if (bet.proposerId === userId) {
      return NextResponse.json({ error: "Cannot accept your own bet" }, { status: 400 });
    }
    if (bet.acceptorId && bet.acceptorId !== userId) {
      return NextResponse.json({ error: "This bet is targeted at another user" }, { status: 403 });
    }

    const updated = await db.p2PSideBet.update({
      where: { id: betId },
      data: { status: "accepted", acceptorId: userId },
    });

    return NextResponse.json({ id: updated.id, status: updated.status });
  }

  if (action === "decline") {
    if (bet.status !== "proposed") {
      return NextResponse.json({ error: "Bet is not in proposed state" }, { status: 400 });
    }
    if (bet.proposerId !== userId && bet.acceptorId !== userId) {
      return NextResponse.json({ error: "Not involved in this bet" }, { status: 403 });
    }

    const updated = await db.p2PSideBet.update({
      where: { id: betId },
      data: { status: "declined" },
    });

    return NextResponse.json({ id: updated.id, status: updated.status });
  }

  if (action === "settle") {
    if (bet.status !== "accepted") {
      return NextResponse.json({ error: "Bet must be accepted before settling" }, { status: 400 });
    }
    // Only a neutral party (room creator or platform admin) may settle to prevent self-awarding
    const room = await db.room.findUnique({ where: { id: roomId }, select: { creatorId: true } });
    const isManager = session.user.role === "admin" || room?.creatorId === userId;
    if (!isManager) {
      return NextResponse.json({ error: "Only the room creator or admin can settle P2P bets" }, { status: 403 });
    }
    if (winner !== "proposer" && winner !== "acceptor") {
      return NextResponse.json({ error: "winner must be 'proposer' or 'acceptor'" }, { status: 400 });
    }

    const updated = await db.p2PSideBet.update({
      where: { id: betId },
      data: { status: "settled", winner },
    });

    return NextResponse.json({ id: updated.id, status: updated.status, winner: updated.winner });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
