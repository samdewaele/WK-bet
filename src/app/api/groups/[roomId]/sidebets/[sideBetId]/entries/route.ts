import { NextRequest, NextResponse } from "next/server";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { isTournamentStarted } from "@/lib/tournament-lock";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string; sideBetId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { roomId, sideBetId } = await params;
  const userId = session.user.id;

  if (await isTournamentStarted()) {
    return NextResponse.json({ error: "Tournament has started — Uber Pot Bets are locked" }, { status: 403 });
  }

  const membership = await db.roomMember.findUnique({
    where: { userId_roomId: { userId, roomId } },
  });
  if (!membership) return NextResponse.json({ error: "Not a member" }, { status: 403 });

  const roomRow = await db.room.findUnique({ where: { id: roomId }, select: { status: true } });
  if (roomRow && !["setup", "betting"].includes(roomRow.status)) {
    return NextResponse.json({ error: "Betting is closed — Uber Pot answers are locked" }, { status: 403 });
  }

  const sideBet = await db.sideBet.findFirst({ where: { id: sideBetId, roomId } });
  if (!sideBet) return NextResponse.json({ error: "Uber Pot Bet not found" }, { status: 404 });
  if (sideBet.status === "proposed") {
    return NextResponse.json({ error: "This bet hasn't been accepted yet" }, { status: 400 });
  }
  if (sideBet.status === "settled") {
    return NextResponse.json({ error: "This bet is already settled" }, { status: 400 });
  }

  let body: { answer?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const answer = body.answer?.trim();
  if (!answer) return NextResponse.json({ error: "Answer is required" }, { status: 400 });

  const entry = await db.sideBetEntry.upsert({
    where: { sideBetId_userId: { sideBetId, userId } },
    create: { sideBetId, userId, answer },
    update: { answer },
  });

  return NextResponse.json({ id: entry.id, sideBetId: entry.sideBetId, userId: entry.userId, answer: entry.answer });
}
