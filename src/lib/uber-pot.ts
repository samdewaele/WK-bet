import { db } from "@/lib/db";
import { calculatePot, prizePerSideBet } from "@/lib/pot";

/**
 * Per-bet settlement result: which entry won and how much that entry earned.
 */
export type BetResult = {
  winnerEntryId: string | null;
  winnerUserId: string | null;
  prize: number;
};

export type UberPotResults = {
  /** Remaining pot that flows into the Uber Pot side bets. */
  uberPot: number;
  /** Equal share each settled side bet pays its winner. */
  prizePerSettledBet: number;
  /** Number of settled side bets. */
  settledCount: number;
  /** sideBetId → { winnerEntryId, winnerUserId, prize }. Only settled bets. */
  byBet: Map<string, BetResult>;
  /** userId → total Uber Pot winnings across all settled bets. */
  byUser: Map<string, number>;
};

/**
 * Single source of truth for Uber Pot money math.
 *
 * The Uber Pot is whatever's left of the total pot after group-stage and KO
 * prizes are distributed. It is split equally across all *settled* side bets;
 * each settled bet pays its winner that share. Open/proposed bets reserve no
 * money until they settle.
 *
 * Mirrors the calculation in the leaderboard routes so the Predictions tab,
 * the Side Bets panel, and the leaderboard always agree.
 */
export async function computeUberPotResults(roomId: string): Promise<UberPotResults> {
  const empty: UberPotResults = {
    uberPot: 0,
    prizePerSettledBet: 0,
    settledCount: 0,
    byBet: new Map(),
    byUser: new Map(),
  };

  const room = await db.room.findUnique({
    where: { id: roomId },
    include: {
      members: { select: { userId: true, excludedFromPot: true } },
      sideBets: { include: { entries: { select: { id: true, userId: true } } } },
    },
  });
  if (!room) return empty;

  const activeMemberCount = room.members.filter((m) => !m.excludedFromPot).length;
  const pot = calculatePot(room.entryFee, activeMemberCount);

  // Only non-excluded members' earnings reduce the remaining uber pot.
  const excludedIds = room.members.filter((m) => m.excludedFromPot).map((m) => m.userId);
  const [groupAgg, koAgg] = await Promise.all([
    db.groupStandingPrediction.aggregate({
      where: { roomId, ...(excludedIds.length > 0 ? { userId: { notIn: excludedIds } } : {}) },
      _sum: { earnedAmount: true },
    }),
    db.kOPrediction.aggregate({
      where: { roomId, ...(excludedIds.length > 0 ? { userId: { notIn: excludedIds } } : {}) },
      _sum: { earnedAmount: true },
    }),
  ]);
  const uberPot = Math.max(
    0,
    pot.totalPot - (groupAgg._sum.earnedAmount ?? 0) - (koAgg._sum.earnedAmount ?? 0),
  );

  const settled = room.sideBets.filter((sb) => sb.status === "settled");
  const prizeEach = prizePerSideBet(uberPot, settled.length);

  const byBet = new Map<string, BetResult>();
  const byUser = new Map<string, number>();
  for (const sb of settled) {
    const winnerEntry = sb.winnerEntryId
      ? sb.entries.find((e) => e.id === sb.winnerEntryId)
      : undefined;
    const winnerUserId = winnerEntry?.userId ?? null;
    byBet.set(sb.id, { winnerEntryId: sb.winnerEntryId, winnerUserId, prize: prizeEach });
    if (winnerUserId) {
      byUser.set(winnerUserId, (byUser.get(winnerUserId) ?? 0) + prizeEach);
    }
  }

  return { uberPot, prizePerSettledBet: prizeEach, settledCount: settled.length, byBet, byUser };
}
