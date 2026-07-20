import { NextRequest, NextResponse } from "next/server";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { isTournamentStarted } from "@/lib/tournament-lock";
import {
  emailMemberLeft,
  emailRemovedFromGroup,
  emailMemberRemovedByAdmin,
} from "@/lib/email";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ roomId: string; targetUserId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { roomId, targetUserId } = await params;

  const room = await db.room.findUnique({ where: { id: roomId }, select: { creatorId: true } });
  if (!room) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isCreator = room.creatorId === session.user.id;
  const isPlatformAdmin = session.user.role === "admin";
  if (!isCreator && !isPlatformAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { paid?: boolean };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body.paid !== "boolean") {
    return NextResponse.json({ error: "paid must be a boolean" }, { status: 400 });
  }

  const updated = await db.roomMember.update({
    where: { userId_roomId: { userId: targetUserId, roomId } },
    data: { paid: body.paid },
  });

  return NextResponse.json({ userId: updated.userId, paid: updated.paid });
}

type Params = { params: Promise<{ roomId: string; targetUserId: string }> };

export async function DELETE(_req: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { roomId, targetUserId } = await params;
  const actorId = session.user.id;
  const isSelf = actorId === targetUserId;

  if (await isTournamentStarted()) {
    return NextResponse.json(
      { error: "Tournament has started — group membership is locked" },
      { status: 403 },
    );
  }

  const room = await db.room.findUnique({
    where: { id: roomId },
    include: {
      creator: { select: { id: true, name: true, email: true } },
      members: { include: { user: { select: { id: true, name: true, email: true } } } },
    },
  });
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  const isCreator = room.creatorId === actorId;
  const isPlatformAdmin = session.user.role === "admin";
  const isManager = isCreator || isPlatformAdmin;

  if (!isSelf && !isManager) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Creator cannot leave their own group (must disband instead)
  if (isSelf && room.creatorId === actorId) {
    return NextResponse.json(
      { error: "You created this group — disband it instead of leaving" },
      { status: 400 },
    );
  }

  const targetMember = room.members.find((m) => m.userId === targetUserId);
  if (!targetMember) return NextResponse.json({ error: "Not a member" }, { status: 404 });

  // Cascading removal within the room
  await db.prediction.deleteMany({ where: { userId: targetUserId, roomId } });
  await db.kOPrediction.deleteMany({ where: { userId: targetUserId, roomId } });
  await db.groupStandingPrediction.deleteMany({ where: { userId: targetUserId, roomId } });

  // Before deleting entries: reconcile any side bet this member won. A bet can
  // have several winners (a tie) — only un-settle it when this member was the
  // SOLE winner; otherwise keep it settled with the remaining winners (and
  // promote a new primary winner if this member held that slot). This stops the
  // prize silently vanishing while not wrongly re-opening a still-decided tie.
  const wonEntries = await db.sideBetEntry.findMany({
    where: { userId: targetUserId, isWinner: true, sideBet: { roomId } },
    select: { sideBetId: true },
  });
  if (wonEntries.length > 0) {
    const betIds = [...new Set(wonEntries.map((e) => e.sideBetId))];
    const affectedBets = await db.sideBet.findMany({
      where: { id: { in: betIds } },
      select: {
        id: true,
        winnerEntryId: true,
        entries: { where: { isWinner: true }, select: { id: true, userId: true } },
      },
    });
    for (const bet of affectedBets) {
      const remaining = bet.entries.filter((e) => e.userId !== targetUserId);
      if (remaining.length === 0) {
        await db.sideBet.update({ where: { id: bet.id }, data: { winnerEntryId: null, status: "open" } });
      } else if (!remaining.some((e) => e.id === bet.winnerEntryId)) {
        // The removed member held the primary winner slot — promote a survivor.
        await db.sideBet.update({ where: { id: bet.id }, data: { winnerEntryId: remaining[0].id } });
      }
    }
  }
  await db.sideBetEntry.deleteMany({ where: { userId: targetUserId, sideBet: { roomId } } });

  // Cancel all P2P bets where this member is proposer or acceptor (any status)
  await db.p2PSideBet.updateMany({
    where: { roomId, proposerId: targetUserId, status: { not: "settled" } },
    data: { status: "declined" },
  });
  await db.p2PSideBet.updateMany({
    where: { roomId, acceptorId: targetUserId, status: { not: "settled" } },
    data: { status: "declined" },
  });

  await db.roomMember.delete({ where: { userId_roomId: { userId: targetUserId, roomId } } });

  // Emails — fire-and-forget
  const targetUser = targetMember.user;
  const actorName = session.user.name ?? "Admin";

  if (isSelf) {
    if (room.creator?.email) {
      emailMemberLeft(room.creator.email, targetUser.name ?? "A member", room.name, roomId).catch(
        () => {},
      );
    }
  } else {
    if (targetUser.email) {
      emailRemovedFromGroup(targetUser.email, targetUser.name ?? "Member", room.name).catch(
        () => {},
      );
    }
    // Email creator only when a platform admin did the removing (not the creator themselves)
    if (!isCreator && room.creator?.email) {
      emailMemberRemovedByAdmin(
        room.creator.email,
        targetUser.name ?? "Member",
        room.name,
        roomId,
        actorName,
      ).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true });
}
