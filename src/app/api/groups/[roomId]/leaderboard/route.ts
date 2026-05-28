import { NextResponse } from "next/server";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { calculatePot, prizePerSideBet } from "@/lib/pot";

export async function GET(
  _req: Request,
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

  const room = await db.room.findUnique({
    where: { id: roomId },
    include: {
      members: { include: { user: { select: { id: true, name: true, image: true } } } },
      sideBets: {
        include: { entries: { select: { id: true, userId: true } } },
      },
    },
  });

  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const pot = calculatePot(room.entryFee, room.members.length);

  const groupPredictions = await db.groupStandingPrediction.findMany({
    where: { roomId },
    select: { userId: true, earnedAmount: true },
  });

  const knockoutPredictions = await db.prediction.findMany({
    where: { roomId },
    select: { userId: true, earnedAmount: true },
  });

  const groupEarnings = new Map<string, number>();
  for (const p of groupPredictions) {
    const current = groupEarnings.get(p.userId) ?? 0;
    groupEarnings.set(p.userId, current + (p.earnedAmount ?? 0));
  }

  const koEarnings = new Map<string, number>();
  for (const p of knockoutPredictions) {
    const current = koEarnings.get(p.userId) ?? 0;
    koEarnings.set(p.userId, current + (p.earnedAmount ?? 0));
  }

  const totalGroupDistributed = [...groupEarnings.values()].reduce((a, b) => a + b, 0);
  const totalKODistributed = [...koEarnings.values()].reduce((a, b) => a + b, 0);
  const uberPot = Math.max(
    0,
    pot.totalPot - totalGroupDistributed - totalKODistributed
  );

  const settledSideBets = room.sideBets.filter((sb) => sb.status === "settled");
  const sideBetCount = room.sideBets.length;
  const prizeEach = prizePerSideBet(uberPot, sideBetCount);

  const sideBetEarnings = new Map<string, number>();
  for (const sb of settledSideBets) {
    if (!sb.winnerEntryId) continue;
    const winnerEntry = sb.entries.find((e) => e.id === sb.winnerEntryId);
    if (winnerEntry) {
      const current = sideBetEarnings.get(winnerEntry.userId) ?? 0;
      sideBetEarnings.set(winnerEntry.userId, current + prizeEach);
    }
  }

  const leaderboard = room.members
    .map((m) => {
      const excluded = m.excludedFromPot;
      const groupStage = excluded ? 0 : (groupEarnings.get(m.userId) ?? 0);
      const knockout = excluded ? 0 : (koEarnings.get(m.userId) ?? 0);
      const sideBets = excluded ? 0 : (sideBetEarnings.get(m.userId) ?? 0);
      const totalEarned = groupStage + knockout + sideBets;
      return {
        userId: m.userId,
        name: m.user.name,
        image: m.user.image,
        groupStage,
        knockout,
        sideBets,
        totalEarned,
        excludedFromPot: excluded,
      };
    })
    .sort((a, b) => {
      if (a.excludedFromPot !== b.excludedFromPot) return a.excludedFromPot ? 1 : -1;
      return b.totalEarned - a.totalEarned;
    })
    .map((entry, idx) => ({ rank: idx + 1, ...entry }));

  return NextResponse.json(leaderboard);
}
