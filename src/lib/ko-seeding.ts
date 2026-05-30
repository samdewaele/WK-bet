/**
 * WC 2026 knockout bracket seeding.
 *
 * After the group stage, 32 teams qualify:
 *   - 12 group winners (positions [0] in each group)
 *   - 12 group runners-up (positions [1])
 *   - 8 best third-place teams (ranked by pts → GD → GF)
 *
 * These are assigned to the 16 R32 placeholder matches in the DB,
 * ordered by matchNumber 73–88 (ascending).
 *
 * R32 bracket: official FIFA WC 2026 structure.
 * Third-place slot assignment: constrained greedy (MRV heuristic) —
 * each slot has 5 eligible source groups; the best available eligible
 * team is assigned to the most constrained slot first.
 */

import { db } from "@/lib/db";

export const WC_GROUPS = ["A","B","C","D","E","F","G","H","I","J","K","L"] as const;
export type WCGroup = typeof WC_GROUPS[number];

export interface TeamStats {
  teamId: string;
  group: WCGroup;
  pts: number;
  gd: number;
  gf: number;
}

// ---------------------------------------------------------------------------
// Standings computation
// ---------------------------------------------------------------------------

type MatchInput = {
  homeTeamId: string | null;
  awayTeamId: string | null;
  group: string | null;
  homeScore: number | null;
  awayScore: number | null;
};

function compareTeams(a: TeamStats, b: TeamStats): number {
  return b.pts - a.pts || b.gd - a.gd || b.gf - a.gf;
}

/**
 * Build per-group standings from a list of match results.
 * Returns a Map: group → [1st, 2nd, 3rd, 4th] (sorted by pts/GD/GF).
 */
export function buildStandingsFromMatches(
  matches: MatchInput[]
): Map<WCGroup, TeamStats[]> {
  const statsMap = new Map<WCGroup, Map<string, TeamStats>>();

  for (const m of matches) {
    if (
      !m.homeTeamId ||
      !m.awayTeamId ||
      !m.group ||
      m.homeScore === null ||
      m.awayScore === null
    ) continue;

    const g = m.group as WCGroup;
    if (!statsMap.has(g)) statsMap.set(g, new Map());
    const gMap = statsMap.get(g)!;

    if (!gMap.has(m.homeTeamId)) gMap.set(m.homeTeamId, { teamId: m.homeTeamId, group: g, pts: 0, gd: 0, gf: 0 });
    if (!gMap.has(m.awayTeamId)) gMap.set(m.awayTeamId, { teamId: m.awayTeamId, group: g, pts: 0, gd: 0, gf: 0 });

    const home = gMap.get(m.homeTeamId)!;
    const away = gMap.get(m.awayTeamId)!;
    home.gf += m.homeScore;
    away.gf += m.awayScore;
    home.gd += m.homeScore - m.awayScore;
    away.gd -= m.homeScore - m.awayScore;

    if (m.homeScore > m.awayScore)      { home.pts += 3; }
    else if (m.homeScore < m.awayScore) { away.pts += 3; }
    else                                { home.pts += 1; away.pts += 1; }
  }

  const result = new Map<WCGroup, TeamStats[]>();
  for (const [group, teamMap] of statsMap) {
    result.set(group, [...teamMap.values()].sort(compareTeams));
  }
  return result;
}

/** Re-compute standings directly from the DB (real-tournament path). */
export async function computeGroupStandings(): Promise<Map<WCGroup, TeamStats[]>> {
  const matches = await db.match.findMany({
    where: { round: "Group", status: "finished" },
    select: { homeTeamId: true, awayTeamId: true, group: true, homeScore: true, awayScore: true },
  });
  return buildStandingsFromMatches(matches);
}

// ---------------------------------------------------------------------------
// Third-place selection
// ---------------------------------------------------------------------------

/**
 * Select the 8 best third-place teams from the 12 groups.
 * Returns them sorted best-first (used by assignThirdPlaceTeams).
 */
export function selectBestThirdPlace(
  standings: Map<WCGroup, TeamStats[]>
): TeamStats[] {
  const third: TeamStats[] = [];
  for (const groupStandings of standings.values()) {
    if (groupStandings.length >= 3) third.push(groupStandings[2]);
  }
  return third.sort(compareTeams).slice(0, 8);
}

// ---------------------------------------------------------------------------
// R32 bracket definition — official FIFA WC 2026
// ---------------------------------------------------------------------------

type GroupSlot  = { type: "group"; group: WCGroup; position: 0 | 1 };
// eligible: the 5 groups whose third-place teams may fill this slot
type ThirdSlot  = { type: "third"; eligible: WCGroup[] };
type BracketSlot = GroupSlot | ThirdSlot;

type R32MatchSlot = { home: BracketSlot; away: BracketSlot };

/**
 * 16 R32 match slot definitions, aligned with DB matchNumbers 73–88.
 * Source: official FIFA WC 2026 bracket.
 */
const R32_SLOTS: R32MatchSlot[] = [
  // 73: Runner-up A vs Runner-up B
  { home: { type: "group", group: "A", position: 1 }, away: { type: "group", group: "B", position: 1 } },
  // 74: Winner E vs 3rd (A/B/C/D/F)
  { home: { type: "group", group: "E", position: 0 }, away: { type: "third", eligible: ["A","B","C","D","F"] } },
  // 75: Winner F vs Runner-up C
  { home: { type: "group", group: "F", position: 0 }, away: { type: "group", group: "C", position: 1 } },
  // 76: Winner C vs Runner-up F
  { home: { type: "group", group: "C", position: 0 }, away: { type: "group", group: "F", position: 1 } },
  // 77: Winner I vs 3rd (C/D/F/G/H)
  { home: { type: "group", group: "I", position: 0 }, away: { type: "third", eligible: ["C","D","F","G","H"] } },
  // 78: Runner-up E vs Runner-up I
  { home: { type: "group", group: "E", position: 1 }, away: { type: "group", group: "I", position: 1 } },
  // 79: Winner A vs 3rd (C/E/F/H/I)
  { home: { type: "group", group: "A", position: 0 }, away: { type: "third", eligible: ["C","E","F","H","I"] } },
  // 80: Winner L vs 3rd (E/H/I/J/K)
  { home: { type: "group", group: "L", position: 0 }, away: { type: "third", eligible: ["E","H","I","J","K"] } },
  // 81: Winner D vs 3rd (B/E/F/I/J)
  { home: { type: "group", group: "D", position: 0 }, away: { type: "third", eligible: ["B","E","F","I","J"] } },
  // 82: Winner G vs 3rd (A/E/H/I/J)
  { home: { type: "group", group: "G", position: 0 }, away: { type: "third", eligible: ["A","E","H","I","J"] } },
  // 83: Runner-up K vs Runner-up L
  { home: { type: "group", group: "K", position: 1 }, away: { type: "group", group: "L", position: 1 } },
  // 84: Winner H vs Runner-up J
  { home: { type: "group", group: "H", position: 0 }, away: { type: "group", group: "J", position: 1 } },
  // 85: Winner B vs 3rd (E/F/G/I/J)
  { home: { type: "group", group: "B", position: 0 }, away: { type: "third", eligible: ["E","F","G","I","J"] } },
  // 86: Winner J vs Runner-up H
  { home: { type: "group", group: "J", position: 0 }, away: { type: "group", group: "H", position: 1 } },
  // 87: Winner K vs 3rd (D/E/I/J/L)
  { home: { type: "group", group: "K", position: 0 }, away: { type: "third", eligible: ["D","E","I","J","L"] } },
  // 88: Runner-up D vs Runner-up G
  { home: { type: "group", group: "D", position: 1 }, away: { type: "group", group: "G", position: 1 } },
];

// ---------------------------------------------------------------------------
// Third-place assignment (MRV greedy)
// ---------------------------------------------------------------------------

/**
 * Assign 8 third-place teams to the 8 third-place slots using a
 * minimum-remaining-values (most-constrained-first) greedy heuristic.
 *
 * Each slot specifies which 5 groups are eligible. We repeatedly pick the
 * slot with the fewest eligible teams still available and assign the
 * best remaining eligible team to it. Falls back to any available team
 * if no eligible team remains for a slot (should not happen in practice).
 */
export function assignThirdPlaceTeams(
  bestThird: TeamStats[],
  slots: ThirdSlot[]
): string[] {
  const pool = [...bestThird];
  const assigned: (string | null)[] = new Array(slots.length).fill(null);
  const pending = slots.map((_, i) => i);

  while (pending.length > 0) {
    // Find most constrained pending slot
    let bestIdx = pending[0];
    let bestCount = Infinity;
    for (const si of pending) {
      const count = pool.filter(t => slots[si].eligible.includes(t.group)).length;
      if (count < bestCount) { bestCount = count; bestIdx = si; }
    }

    const eligible = slots[bestIdx].eligible;
    const poolIdx = pool.findIndex(t => eligible.includes(t.group));
    if (poolIdx !== -1) {
      assigned[bestIdx] = pool.splice(poolIdx, 1)[0].teamId;
    } else if (pool.length > 0) {
      // Constraint unsatisfiable for this slot — use best remaining
      assigned[bestIdx] = pool.splice(0, 1)[0].teamId;
    }

    pending.splice(pending.indexOf(bestIdx), 1);
  }

  return assigned as string[];
}

// ---------------------------------------------------------------------------
// Bracket resolution
// ---------------------------------------------------------------------------

/**
 * Resolve R32 bracket slots to concrete {homeTeamId, awayTeamId} pairs.
 * Returns 16 entries aligned with R32_SLOTS (= DB matchNumber order 73–88).
 */
export function resolveR32Bracket(
  standings: Map<WCGroup, TeamStats[]>,
  bestThirdPlace: TeamStats[]
): Array<{ homeTeamId: string; awayTeamId: string }> {
  // Collect all third-place slots and pre-assign them
  const thirdSlots: ThirdSlot[] = R32_SLOTS
    .flatMap(s => [s.home, s.away])
    .filter((s): s is ThirdSlot => s.type === "third");

  const thirdAssignments = assignThirdPlaceTeams(bestThirdPlace, thirdSlots);
  let thirdIdx = 0;

  const resolveSlot = (slot: BracketSlot): string => {
    if (slot.type === "group") {
      const gs = standings.get(slot.group);
      if (!gs || gs.length <= slot.position) {
        throw new Error(`Group ${slot.group} has no team at position ${slot.position}`);
      }
      return gs[slot.position].teamId;
    }
    const teamId = thirdAssignments[thirdIdx++];
    if (!teamId) throw new Error("No third-place team available for slot");
    return teamId;
  };

  return R32_SLOTS.map(slot => ({
    homeTeamId: resolveSlot(slot.home),
    awayTeamId: resolveSlot(slot.away),
  }));
}

// ---------------------------------------------------------------------------
// DB population
// ---------------------------------------------------------------------------

/**
 * Update the 16 R32 placeholder matches in the DB with the correct team IDs.
 * Matches are assigned in matchNumber order (ascending), aligned with R32_SLOTS.
 */
export async function populateR32Bracket(
  standings: Map<WCGroup, TeamStats[]>
): Promise<void> {
  const bestThird = selectBestThirdPlace(standings);
  const bracketTeams = resolveR32Bracket(standings, bestThird);

  const r32Matches = await db.match.findMany({
    where: { round: "R32" },
    orderBy: { matchNumber: "asc" },
    select: { id: true },
  });

  if (r32Matches.length !== 16) {
    throw new Error(`Expected 16 R32 matches in DB, found ${r32Matches.length}. Run npx prisma db seed first.`);
  }

  await Promise.all(
    r32Matches.map((match, i) =>
      db.match.update({
        where: { id: match.id },
        data: {
          homeTeamId: bracketTeams[i].homeTeamId,
          awayTeamId: bracketTeams[i].awayTeamId,
        },
      })
    )
  );
}

/**
 * Reset R32 bracket team assignments back to null.
 * Called during cleanup so the bracket is blank again for the next simulation.
 */
export async function resetR32Bracket(): Promise<void> {
  await db.match.updateMany({
    where: { round: "R32" },
    data: { homeTeamId: null, awayTeamId: null },
  });
}

// ---------------------------------------------------------------------------
// KO bracket progression
// ---------------------------------------------------------------------------

/**
 * Maps each KO match number to the next-round slot the winner fills.
 * SF losers also fill the 3rd-place match slots.
 */
export const NEXT_ROUND_SLOT: Record<
  number,
  {
    winner: { matchNumber: number; side: "home" | "away" };
    loser?: { matchNumber: number; side: "home" | "away" };
  }
> = {
  73:  { winner: { matchNumber: 89,  side: "home" } },
  74:  { winner: { matchNumber: 89,  side: "away" } },
  75:  { winner: { matchNumber: 90,  side: "home" } },
  76:  { winner: { matchNumber: 90,  side: "away" } },
  77:  { winner: { matchNumber: 91,  side: "home" } },
  78:  { winner: { matchNumber: 91,  side: "away" } },
  79:  { winner: { matchNumber: 92,  side: "home" } },
  80:  { winner: { matchNumber: 92,  side: "away" } },
  81:  { winner: { matchNumber: 93,  side: "home" } },
  82:  { winner: { matchNumber: 93,  side: "away" } },
  83:  { winner: { matchNumber: 94,  side: "home" } },
  84:  { winner: { matchNumber: 94,  side: "away" } },
  85:  { winner: { matchNumber: 95,  side: "home" } },
  86:  { winner: { matchNumber: 95,  side: "away" } },
  87:  { winner: { matchNumber: 96,  side: "home" } },
  88:  { winner: { matchNumber: 96,  side: "away" } },
  89:  { winner: { matchNumber: 97,  side: "home" } },
  90:  { winner: { matchNumber: 97,  side: "away" } },
  91:  { winner: { matchNumber: 98,  side: "home" } },
  92:  { winner: { matchNumber: 98,  side: "away" } },
  93:  { winner: { matchNumber: 99,  side: "home" } },
  94:  { winner: { matchNumber: 99,  side: "away" } },
  95:  { winner: { matchNumber: 100, side: "home" } },
  96:  { winner: { matchNumber: 100, side: "away" } },
  97:  { winner: { matchNumber: 101, side: "home" } },
  98:  { winner: { matchNumber: 101, side: "away" } },
  99:  { winner: { matchNumber: 102, side: "home" } },
  100: { winner: { matchNumber: 102, side: "away" } },
  101: { winner: { matchNumber: 104, side: "home" }, loser: { matchNumber: 103, side: "home" } },
  102: { winner: { matchNumber: 104, side: "away" }, loser: { matchNumber: 103, side: "away" } },
  // 103 and 104 are Final/3rd — no next round
};

/**
 * After a KO match finishes, populate the next-round match's team slot(s) in the DB.
 * winnerId: the team that won (home or away based on scores).
 * loserId: the team that lost — only used for SF matches feeding the 3rd-place match.
 */
export async function populateNextRoundSlot(
  matchNumber: number,
  winnerId: string,
  loserId: string | null
): Promise<void> {
  const slot = NEXT_ROUND_SLOT[matchNumber];
  if (!slot) return;

  const nextMatch = await db.match.findFirst({
    where: { matchNumber: slot.winner.matchNumber },
    select: { id: true },
  });
  if (!nextMatch) return;

  await db.match.update({
    where: { id: nextMatch.id },
    data: slot.winner.side === "home"
      ? { homeTeamId: winnerId }
      : { awayTeamId: winnerId },
  });

  if (slot.loser && loserId) {
    const loserMatch = await db.match.findFirst({
      where: { matchNumber: slot.loser.matchNumber },
      select: { id: true },
    });
    if (loserMatch) {
      await db.match.update({
        where: { id: loserMatch.id },
        data: slot.loser.side === "home"
          ? { homeTeamId: loserId }
          : { awayTeamId: loserId },
      });
    }
  }
}

/**
 * Reset all R16/QF/SF/3rd/Final bracket team slots back to null.
 * Called alongside resetR32Bracket during simulation cleanup.
 */
export async function resetKOBracket(): Promise<void> {
  await db.match.updateMany({
    where: { round: { in: ["R16", "QF", "SF", "3rd", "Final"] } },
    data: { homeTeamId: null, awayTeamId: null },
  });
}
