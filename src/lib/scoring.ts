/**
 * Shared money-scoring logic for the real tournament (sync-matches) AND the
 * preset e2e harness. Keeping a single source of truth here prevents the two
 * paths from drifting apart — the class of bug that produced "total winnings
 * exceed the pot".
 *
 * Both group standings and KO matches use the same rule:
 *   only the highest-scoring tier of predictions wins a prize; the prize is
 *   split equally within that tier. Everything below the top tier earns 0,
 *   and that unclaimed money is what flows into the Uber Pot.
 */
import { db } from "@/lib/db";
import {
  calculatePot,
  scoreGroupStanding,
  earnedFromGroupStanding,
  scoreKnockoutMatchWithTeams,
  type KORound,
} from "@/lib/pot";
import { calculatePoints, type Round } from "@/lib/points";
import { buildStandingsFromMatches, populateGroupQualifiers, buildPlayerBracket, type WCGroup } from "@/lib/ko-seeding";

type Top4 = [string, string, string, string];

/** Set of userIds excluded from the pot in a room (never win, never count toward splits). */
async function excludedUserIds(roomId: string): Promise<Set<string>> {
  const rows = await db.roomMember.findMany({
    where: { roomId, excludedFromPot: true },
    select: { userId: true },
  });
  return new Set(rows.map((r) => r.userId));
}

/** Rooms with the data needed to compute their pot. */
async function roomsWithPot() {
  // The pot is sized on members who are IN the pot — must match every read path
  // (leaderboard/standings/uber-pot all use the non-excluded count). Using the
  // raw total here made distributed winnings exceed the real pot.
  const rooms = await db.room.findMany({
    select: { id: true, entryFee: true, members: { select: { excludedFromPot: true } } },
  });
  return rooms.map((r) => ({
    id: r.id,
    entryFee: r.entryFee,
    memberCount: r.members.filter((m) => !m.excludedFromPot).length,
  }));
}

/**
 * Score one room's group-standing predictions for a single completed group.
 * Sets earnedAmount on every prediction (0 for non-winners).
 */
export async function scoreRoomGroupStanding(
  roomId: string,
  group: string,
  actualTop4: Top4,
  prizePerGroup: number,
): Promise<void> {
  const [preds, excluded] = await Promise.all([
    db.groupStandingPrediction.findMany({ where: { roomId, wcGroup: group } }),
    excludedUserIds(roomId),
  ]);
  if (preds.length === 0) return;

  const scored = preds.map((gp) => {
    const predicted = [gp.position1, gp.position2, gp.position3, gp.position4] as Top4;
    return {
      id: gp.id,
      predicted,
      excluded: excluded.has(gp.userId),
      multiplier: scoreGroupStanding(predicted, actualTop4).scoreMultiplier,
    };
  });
  // The winning tier + split are computed over IN-POT members only — an excluded
  // member tying the top tier must not inflate topCount and shrink real winners'
  // shares. Excluded members always earn 0.
  const eligible = scored.filter((s) => !s.excluded);
  const maxMultiplier = eligible.reduce((m, s) => Math.max(m, s.multiplier), 0);
  const topCount = eligible.filter((s) => s.multiplier === maxMultiplier && maxMultiplier > 0).length;

  await Promise.all(
    scored.map((s) => {
      const earnedAmount =
        !s.excluded && s.multiplier === maxMultiplier && maxMultiplier > 0
          ? earnedFromGroupStanding(s.predicted, actualTop4, prizePerGroup, topCount)
          : 0;
      return db.groupStandingPrediction.update({ where: { id: s.id }, data: { earnedAmount } });
    }),
  );
}

/**
 * Score one room's KO predictions for a single finished match.
 * Sets both points (accuracy) and earnedAmount (money).
 *
 * Scoring is team-aware: a prediction only earns money if the player
 * predicted the correct winning team to be in this match, determined by
 * tracing their full bracket from R32 upward.
 */
export async function scoreRoomKOMatch(
  roomId: string,
  matchId: string,
  round: Round,
  matchPrize: number,
  actualHome: number,
  actualAway: number,
): Promise<void> {
  const [koMatches, allRoomPreds, excluded] = await Promise.all([
    db.match.findMany({
      where: { round: { in: ["R32", "R16", "QF", "SF", "3rd", "Final"] } },
      select: { id: true, matchNumber: true, homeTeamId: true, awayTeamId: true, penaltyWinner: true },
      orderBy: { matchNumber: "asc" },
    }),
    db.kOPrediction.findMany({
      where: { roomId },
      select: { id: true, userId: true, matchId: true, homeScore: true, awayScore: true, penaltyWinner: true },
    }),
    excludedUserIds(roomId),
  ]);

  const matchPreds = allRoomPreds.filter((p) => p.matchId === matchId);
  if (matchPreds.length === 0) return;

  const thisMatch = koMatches.find((m) => m.id === matchId);
  const actualHomeTeamId = thisMatch?.homeTeamId ?? null;
  const actualAwayTeamId = thisMatch?.awayTeamId ?? null;
  const actualPenaltyWinner = thisMatch?.penaltyWinner ?? null;

  // Build each user's predicted bracket (traces R32 predictions upward)
  const predsByUser = new Map<string, typeof allRoomPreds>();
  for (const p of allRoomPreds) {
    if (!predsByUser.has(p.userId)) predsByUser.set(p.userId, []);
    predsByUser.get(p.userId)!.push(p);
  }
  const userBrackets = new Map<string, ReturnType<typeof buildPlayerBracket>>();
  for (const [userId, userPreds] of predsByUser) {
    userBrackets.set(userId, buildPlayerBracket(userPreds, koMatches));
  }

  const scored = matchPreds.map((p) => {
    const predictedSlot = userBrackets.get(p.userId)?.get(matchId);
    return {
      id: p.id,
      excluded: excluded.has(p.userId),
      homeScore: p.homeScore,
      awayScore: p.awayScore,
      points: calculatePoints(round, p.homeScore, p.awayScore, actualHome, actualAway),
      multiplier: scoreKnockoutMatchWithTeams(
        p.homeScore, p.awayScore, actualHome, actualAway,
        predictedSlot?.homeTeamId ?? null,
        predictedSlot?.awayTeamId ?? null,
        actualHomeTeamId,
        actualAwayTeamId,
        p.penaltyWinner,
        actualPenaltyWinner,
      ).scoreMultiplier,
    };
  });

  // Winning tier + split over IN-POT members only (excluded members earn 0 and
  // must not inflate the split).
  const eligible = scored.filter((s) => !s.excluded);
  const maxMultiplier = eligible.reduce((m, s) => Math.max(m, s.multiplier), 0);
  const topCount = eligible.filter((s) => s.multiplier === maxMultiplier && maxMultiplier > 0).length;

  await Promise.all(
    scored.map((s) => {
      const earnedAmount =
        !s.excluded && s.multiplier === maxMultiplier && maxMultiplier > 0
          ? (matchPrize * s.multiplier) / topCount
          : 0;
      return db.kOPrediction.update({ where: { id: s.id }, data: { points: s.points, earnedAmount } });
    }),
  );
}

/** Score a single finished KO match across every room. */
export async function scoreKOMatchForAllRooms(
  matchId: string,
  round: KORound,
  actualHome: number,
  actualAway: number,
): Promise<void> {
  const rooms = await roomsWithPot();
  for (const room of rooms) {
    const pot = calculatePot(room.entryFee, room.memberCount);
    const matchPrize = pot.prizePerKOMatch[round] ?? 0;
    await scoreRoomKOMatch(room.id, matchId, round, matchPrize, actualHome, actualAway);
  }
}

/**
 * Re-score EVERY finished KO match across all rooms. KO scoring is team-aware,
 * so when an upstream result changes the downstream slots' actual teams change
 * (via repropagation) — but those rounds were already scored against the old
 * teams. Re-running all finished matches after a bracket rebuild keeps earnings
 * consistent. Idempotent (earnedAmount is overwritten), so it's safe to repeat.
 */
export async function rescoreFinishedKOMatches(): Promise<void> {
  const finished = await db.match.findMany({
    where: {
      round: { in: ["R32", "R16", "QF", "SF", "3rd", "Final"] },
      status: "finished",
      homeScore: { not: null },
      awayScore: { not: null },
    },
    select: { id: true, round: true, homeScore: true, awayScore: true },
    orderBy: { matchNumber: "asc" },
  });
  for (const m of finished) {
    await scoreKOMatchForAllRooms(m.id, m.round as KORound, m.homeScore!, m.awayScore!);
  }
}

/**
 * Find every WC group whose matches are ALL finished, then for each:
 *   1. drop its winner + runner-up into their R32 slots (progressive bracket)
 *   2. score every room's standing prediction for that group (live Uber Pot)
 *
 * Idempotent — safe to run on every sync; re-scoring a settled group is a
 * deterministic no-op.
 */
export async function scoreAndAdvanceCompletedGroups(): Promise<void> {
  const groupMatches = await db.match.findMany({
    where: { round: "Group" },
    select: { group: true, status: true, homeTeamId: true, awayTeamId: true, homeScore: true, awayScore: true },
  });

  const tally = new Map<string, { finished: number; total: number }>();
  for (const m of groupMatches) {
    if (!m.group) continue;
    const e = tally.get(m.group) ?? { finished: 0, total: 0 };
    e.total++;
    if (m.status === "finished") e.finished++;
    tally.set(m.group, e);
  }
  const completeGroups = [...tally.entries()]
    .filter(([, v]) => v.total > 0 && v.finished === v.total)
    .map(([g]) => g);
  if (completeGroups.length === 0) return;

  const standings = buildStandingsFromMatches(groupMatches.filter((m) => m.status === "finished"));
  const rooms = await roomsWithPot();

  for (const g of completeGroups) {
    const ordered = standings.get(g as WCGroup);
    if (!ordered || ordered.length < 4) continue;
    const top4 = [ordered[0].teamId, ordered[1].teamId, ordered[2].teamId, ordered[3].teamId] as Top4;

    await populateGroupQualifiers(g, ordered[0].teamId, ordered[1].teamId).catch(() => {});

    for (const room of rooms) {
      const pot = calculatePot(room.entryFee, room.memberCount);
      await scoreRoomGroupStanding(room.id, g, top4, pot.groupStagePot / 12);
    }
  }
}
