import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { calculatePot } from "@/lib/pot";
import { requireRoomAccess } from "@/lib/room-auth";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const access = await requireRoomAccess(roomId);
  if (access instanceof NextResponse) return access;

  const room = await db.room.findUnique({
    where: { id: roomId },
    include: {
      members: { include: { user: { select: { id: true, name: true, image: true } } } },
      sideBets: { include: { entries: { include: { user: { select: { id: true, name: true } } } } } },
      p2pBets: {
        include: {
          proposer: { select: { id: true, name: true, image: true } },
          acceptor: { select: { id: true, name: true, image: true } },
        },
      },
    },
  });

  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const pot = calculatePot(room.entryFee, room.members.length);

  return NextResponse.json({
    id: room.id,
    name: room.name,
    inviteCode: room.inviteCode,
    entryFee: room.entryFee,
    status: room.status,
    createdAt: room.createdAt.toISOString(),
    pot,
    members: room.members.map((m) => ({
      userId: m.userId,
      name: m.user.name,
      image: m.user.image,
    })),
    sideBets: room.sideBets.map((sb) => ({
      id: sb.id,
      title: sb.title,
      description: sb.description,
      status: sb.status,
      winnerEntryId: sb.winnerEntryId,
      entries: sb.entries.map((e) => ({
        id: e.id,
        userId: e.userId,
        userName: e.user.name,
        answer: e.answer,
      })),
    })),
    p2pBets: room.p2pBets.map((b) => ({
      id: b.id,
      proposerId: b.proposerId,
      proposerName: b.proposer.name,
      acceptorId: b.acceptorId,
      acceptorName: b.acceptor?.name ?? null,
      amount: b.amount,
      description: b.description,
      status: b.status,
      winner: b.winner,
      createdAt: b.createdAt.toISOString(),
    })),
  });
}
