import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { calculatePot, prizePerSideBet } from "@/lib/pot";
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
      sideBets: {
        include: { entries: { select: { id: true, userId: true, isWinner: true } } },
      },
    },
  });

  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const activeMemberCount = room.members.filter((m) => !m.excludedFromPot).length;
  const pot = calculatePot(room.entryFee, activeMemberCount);

  const excludedIds = new Set(room.members.filter((m) => m.excludedFromPot).map((m) => m.userId));

  const groupPredictions = await db.groupStandingPrediction.findMany({
    where: { roomId },
    select: { userId: true, earnedAmount: true },
  });

  const knockoutPredictions = await db.kOPrediction.findMany({
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

  // Only count non-excluded members' earnings when computing the remaining uber pot
  const totalGroupDistributed = [...groupEarnings.entries()]
    .filter(([uid]) => !excludedIds.has(uid))
    .reduce((a, [, v]) => a + v, 0);
  const totalKODistributed = [...koEarnings.entries()]
    .filter(([uid]) => !excludedIds.has(uid))
    .reduce((a, [, v]) => a + v, 0);
  const uberPot = Math.max(
    0,
    pot.totalPot - totalGroupDistributed - totalKODistributed
  );

  const settledSideBets = room.sideBets.filter((sb) => sb.status === "settled");
  // Divide uber pot only among settled bets — open/proposed shares are reserved for future winners
  const sideBetCount = settledSideBets.length;
  const prizeEach = prizePerSideBet(uberPot, sideBetCount);

  const sideBetEarnings = new Map<string, number>();
  for (const sb of settledSideBets) {
    // A bet can have several winners (a tie); they split its share equally.
    let winners = sb.entries.filter((e) => e.isWinner);
    if (winners.length === 0 && sb.winnerEntryId) {
      const legacy = sb.entries.find((e) => e.id === sb.winnerEntryId);
      if (legacy) winners = [legacy];
    }
    if (winners.length === 0) continue;
    const perWinner = prizeEach / winners.length;
    for (const w of winners) {
      sideBetEarnings.set(w.userId, (sideBetEarnings.get(w.userId) ?? 0) + perWinner);
    }
  }

  const toCents = (v: number) => Math.round(v * 100);
  const fromCents = (c: number) => c / 100;

  const leaderboard = room.members
    .map((m) => {
      const excluded = m.excludedFromPot;
      // Round each component to whole cents before summing to avoid
      // floating-point display inconsistency (columns summing to a different
      // value than the total when each is independently .toFixed(2)'d).
      const groupStageCents = toCents(excluded ? 0 : (groupEarnings.get(m.userId) ?? 0));
      const knockoutCents   = toCents(excluded ? 0 : (koEarnings.get(m.userId) ?? 0));
      const sideBetsCents   = toCents(excluded ? 0 : (sideBetEarnings.get(m.userId) ?? 0));
      const totalCents      = groupStageCents + knockoutCents + sideBetsCents;
      return {
        userId: m.userId,
        name: m.user.name,
        image: m.user.image,
        groupStage:  fromCents(groupStageCents),
        knockout:    fromCents(knockoutCents),
        sideBets:    fromCents(sideBetsCents),
        totalEarned: fromCents(totalCents),
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
