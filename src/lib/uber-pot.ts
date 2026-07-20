import { db } from "@/lib/db";
import { calculatePot, prizePerSideBet, KO_MATCH_WEIGHT, type KORound } from "@/lib/pot";

/**
 * Per-bet settlement result: which entries won and how much each one earned.
 *
 * A bet can have several winners (a tie). The bet's equal share of the Uber Pot
 * (`betShare`) is split evenly across them, so `prizePerWinner` is what each
 * individual winner actually receives. `winnerEntryId`/`winnerUserId` expose the
 * first winner for single-winner callers that haven't been updated.
 */
export type BetResult = {
  winnerEntryIds: string[];
  winnerUserIds: string[];
  /** Convenience: the first winner (or null). */
  winnerEntryId: string | null;
  winnerUserId: string | null;
  /** This bet's total share of the Uber Pot (split across all winners). */
  betShare: number;
  /** What each winner of this bet receives (betShare / winnerCount). */
  prizePerWinner: number;
  /** @deprecated alias of prizePerWinner, kept for existing callers. */
  prize: number;
};

export type UberPotResults = {
  /** Remaining pot that flows into the Uber Pot side bets. */
  uberPot: number;
  /**
   * Unclaimed prizes from COMPLETED groups and KO matches only.
   * Starts at 0 and grows as results come in where nobody predicted correctly.
   * This is the amount currently "in" the Uber Pot from real results.
   */
  accumulatedUberPot: number;
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
    accumulatedUberPot: 0,
    prizePerSettledBet: 0,
    settledCount: 0,
    byBet: new Map(),
    byUser: new Map(),
  };

  const room = await db.room.findUnique({
    where: { id: roomId },
    include: {
      members: { select: { userId: true, excludedFromPot: true } },
      sideBets: { include: { entries: { select: { id: true, userId: true, isWinner: true } } } },
    },
  });
  if (!room) return empty;

  const activeMemberCount = room.members.filter((m) => !m.excludedFromPot).length;
  const pot = calculatePot(room.entryFee, activeMemberCount);

  // Only non-excluded members' earnings reduce the remaining uber pot.
  const excludedIds = room.members.filter((m) => m.excludedFromPot).map((m) => m.userId);
  const excludeFilter = excludedIds.length > 0 ? { userId: { notIn: excludedIds } } : {};

  // groupBy so we can compute both total-distributed and per-group unclaimed in one pass.
  const [groupByWcGroup, koByMatch] = await Promise.all([
    db.groupStandingPrediction.groupBy({
      by: ["wcGroup"],
      where: { roomId, earnedAmount: { not: null }, ...excludeFilter },
      _sum: { earnedAmount: true },
    }),
    db.kOPrediction.groupBy({
      by: ["matchId"],
      where: { roomId, earnedAmount: { not: null }, ...excludeFilter },
      _sum: { earnedAmount: true },
    }),
  ]);

  const totalGroupDistributed = groupByWcGroup.reduce((s, g) => s + (g._sum.earnedAmount ?? 0), 0);
  const totalKODistributed = koByMatch.reduce((s, m) => s + (m._sum.earnedAmount ?? 0), 0);
  const uberPot = Math.max(0, pot.totalPot - totalGroupDistributed - totalKODistributed);

  // Accumulated uber pot: starts at 0, grows as groups/KO matches finish with unclaimed prize money.
  const groupUnclaimed = groupByWcGroup.reduce(
    (s, g) => s + Math.max(0, pot.prizePerWCGroup - (g._sum.earnedAmount ?? 0)),
    0,
  );

  let koUnclaimed = 0;
  if (koByMatch.length > 0) {
    const matchRoundRows = await db.match.findMany({
      where: { id: { in: koByMatch.map((m) => m.matchId) } },
      select: { id: true, round: true },
    });
    const roundByMatch = new Map(matchRoundRows.map((r) => [r.id, r.round as KORound]));
    koUnclaimed = koByMatch.reduce((s, m) => {
      const round = roundByMatch.get(m.matchId);
      if (!round || !KO_MATCH_WEIGHT[round]) return s;
      return s + Math.max(0, pot.koUnit * KO_MATCH_WEIGHT[round] - (m._sum.earnedAmount ?? 0));
    }, 0);
  }
  const accumulatedUberPot = groupUnclaimed + koUnclaimed;

  const settled = room.sideBets.filter((sb) => sb.status === "settled");
  const prizeEach = prizePerSideBet(uberPot, settled.length);

  const byBet = new Map<string, BetResult>();
  const byUser = new Map<string, number>();
  for (const sb of settled) {
    // Winners are the flagged entries; fall back to the legacy single
    // winnerEntryId for rows predating the isWinner flag.
    let winners = sb.entries.filter((e) => e.isWinner);
    if (winners.length === 0 && sb.winnerEntryId) {
      const legacy = sb.entries.find((e) => e.id === sb.winnerEntryId);
      if (legacy) winners = [legacy];
    }
    const prizePerWinner = winners.length > 0 ? prizeEach / winners.length : 0;
    byBet.set(sb.id, {
      winnerEntryIds: winners.map((w) => w.id),
      winnerUserIds: winners.map((w) => w.userId),
      winnerEntryId: winners[0]?.id ?? null,
      winnerUserId: winners[0]?.userId ?? null,
      betShare: prizeEach,
      prizePerWinner,
      prize: prizePerWinner,
    });
    for (const w of winners) {
      byUser.set(w.userId, (byUser.get(w.userId) ?? 0) + prizePerWinner);
    }
  }

  return { uberPot, accumulatedUberPot, prizePerSettledBet: prizeEach, settledCount: settled.length, byBet, byUser };
}
