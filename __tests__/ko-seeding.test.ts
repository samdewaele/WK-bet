import { describe, it, expect } from "vitest";
import {
  buildStandingsFromMatches,
  selectBestThirdPlace,
  assignThirdPlaceTeams,
  resolveR32Bracket,
  type WCGroup,
  type TeamStats,
} from "@/lib/ko-seeding";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStats(teamId: string, group: WCGroup, pts: number, gd: number, gf: number): TeamStats {
  return { teamId, group, pts, gd, gf };
}

/** Build a minimal standings map with one team per position per group. */
function makeStandings(
  groups: WCGroup[],
  teamsPerGroup = 4
): Map<WCGroup, TeamStats[]> {
  const standings = new Map<WCGroup, TeamStats[]>();
  for (const g of groups) {
    const teams: TeamStats[] = [];
    for (let pos = 0; pos < teamsPerGroup; pos++) {
      const pts = (teamsPerGroup - pos) * 3; // descending points
      teams.push(makeStats(`${g}${pos + 1}`, g, pts, teamsPerGroup - pos, teamsPerGroup - pos));
    }
    standings.set(g, teams);
  }
  return standings;
}

const ALL_GROUPS: WCGroup[] = ["A","B","C","D","E","F","G","H","I","J","K","L"];

// ---------------------------------------------------------------------------
// buildStandingsFromMatches
// ---------------------------------------------------------------------------

describe("buildStandingsFromMatches", () => {
  it("ranks teams by pts desc, then gd desc, then gf desc", () => {
    const matches = [
      { homeTeamId: "T1", awayTeamId: "T2", group: "A", homeScore: 3, awayScore: 0 },
      { homeTeamId: "T3", awayTeamId: "T4", group: "A", homeScore: 1, awayScore: 1 },
      { homeTeamId: "T1", awayTeamId: "T3", group: "A", homeScore: 2, awayScore: 1 },
      { homeTeamId: "T2", awayTeamId: "T4", group: "A", homeScore: 2, awayScore: 0 },
      { homeTeamId: "T1", awayTeamId: "T4", group: "A", homeScore: 1, awayScore: 0 },
      { homeTeamId: "T2", awayTeamId: "T3", group: "A", homeScore: 1, awayScore: 0 },
    ];
    const standings = buildStandingsFromMatches(matches);
    const groupA = standings.get("A")!;
    expect(groupA[0].teamId).toBe("T1"); // 9pts
    expect(groupA[1].teamId).toBe("T2"); // 6pts
    expect(groupA.length).toBe(4);
  });

  it("skips matches with missing data", () => {
    const matches = [
      { homeTeamId: null, awayTeamId: "T2", group: "A", homeScore: 1, awayScore: 0 },
      { homeTeamId: "T1", awayTeamId: "T2", group: "A", homeScore: null, awayScore: 0 },
      { homeTeamId: "T3", awayTeamId: "T4", group: "A", homeScore: 2, awayScore: 1 },
    ];
    const standings = buildStandingsFromMatches(matches);
    expect(standings.get("A")!.length).toBe(2); // only T3 and T4 from valid match
  });

  it("handles multiple groups independently", () => {
    const matches = [
      { homeTeamId: "A1", awayTeamId: "A2", group: "A", homeScore: 1, awayScore: 0 },
      { homeTeamId: "B1", awayTeamId: "B2", group: "B", homeScore: 0, awayScore: 2 },
    ];
    const standings = buildStandingsFromMatches(matches);
    expect(standings.get("A")![0].teamId).toBe("A1");
    expect(standings.get("B")![0].teamId).toBe("B2");
  });
});

// ---------------------------------------------------------------------------
// selectBestThirdPlace
// ---------------------------------------------------------------------------

describe("selectBestThirdPlace", () => {
  it("selects exactly 8 from 12 groups", () => {
    const standings = makeStandings(ALL_GROUPS);
    const best = selectBestThirdPlace(standings);
    expect(best.length).toBe(8);
  });

  it("picks the third-place team (index 2) from each group", () => {
    const standings = makeStandings(ALL_GROUPS);
    const best = selectBestThirdPlace(standings);
    for (const t of best) {
      // Each team id is "{group}3" since position 0=1st, 1=2nd, 2=3rd
      expect(t.teamId.endsWith("3")).toBe(true);
    }
  });

  it("ranks selected teams best-first (higher pts first)", () => {
    // Give group A's 3rd place more points than others
    const standings = makeStandings(ALL_GROUPS);
    const groupA = standings.get("A")!;
    groupA[2] = { teamId: "A3", group: "A", pts: 99, gd: 99, gf: 99 };
    const best = selectBestThirdPlace(standings);
    expect(best[0].teamId).toBe("A3");
  });

  it("skips groups with fewer than 3 teams", () => {
    const standings = makeStandings(ALL_GROUPS, 2); // only 2 teams per group
    const best = selectBestThirdPlace(standings);
    expect(best.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// assignThirdPlaceTeams
// ---------------------------------------------------------------------------

describe("assignThirdPlaceTeams", () => {
  it("assigns each team to a slot where its group is eligible", () => {
    const teams: TeamStats[] = [
      makeStats("T_A", "A", 7, 3, 5),
      makeStats("T_B", "B", 6, 2, 4),
      makeStats("T_C", "C", 5, 1, 3),
      makeStats("T_D", "D", 4, 0, 2),
      makeStats("T_E", "E", 3, -1, 1),
      makeStats("T_F", "F", 2, -2, 0),
      makeStats("T_G", "G", 1, -3, -1),
      makeStats("T_H", "H", 0, -4, -2),
    ];
    const slots = [
      { type: "third" as const, eligible: ["A","B","C","D","F"] as WCGroup[] },
      { type: "third" as const, eligible: ["C","D","F","G","H"] as WCGroup[] },
      { type: "third" as const, eligible: ["C","E","F","H","I"] as WCGroup[] },
      { type: "third" as const, eligible: ["E","H","I","J","K"] as WCGroup[] },
      { type: "third" as const, eligible: ["B","E","F","I","J"] as WCGroup[] },
      { type: "third" as const, eligible: ["A","E","H","I","J"] as WCGroup[] },
      { type: "third" as const, eligible: ["E","F","G","I","J"] as WCGroup[] },
      { type: "third" as const, eligible: ["D","E","I","J","L"] as WCGroup[] },
    ];
    const assigned = assignThirdPlaceTeams(teams, slots);
    expect(assigned.length).toBe(8);
    // Each assigned team must come from an eligible group for its slot
    for (let i = 0; i < 8; i++) {
      const teamId = assigned[i];
      const team = teams.find(t => t.teamId === teamId)!;
      expect(slots[i].eligible).toContain(team.group);
    }
    // All teams assigned (no duplicates)
    expect(new Set(assigned).size).toBe(8);
  });

  it("assigns every team exactly once", () => {
    const teams: TeamStats[] = ALL_GROUPS.slice(0, 8).map((g, i) =>
      makeStats(`T_${g}`, g as WCGroup, 8 - i, 0, 0)
    );
    const slots = [
      { type: "third" as const, eligible: ["A","B","C","D","F"] as WCGroup[] },
      { type: "third" as const, eligible: ["C","D","F","G","H"] as WCGroup[] },
      { type: "third" as const, eligible: ["C","E","F","H","I"] as WCGroup[] },
      { type: "third" as const, eligible: ["E","H","I","J","K"] as WCGroup[] },
      { type: "third" as const, eligible: ["B","E","F","I","J"] as WCGroup[] },
      { type: "third" as const, eligible: ["A","E","H","I","J"] as WCGroup[] },
      { type: "third" as const, eligible: ["E","F","G","I","J"] as WCGroup[] },
      { type: "third" as const, eligible: ["D","E","I","J","L"] as WCGroup[] },
    ];
    const assigned = assignThirdPlaceTeams(teams, slots);
    expect(new Set(assigned).size).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// resolveR32Bracket
// ---------------------------------------------------------------------------

describe("resolveR32Bracket", () => {
  it("returns exactly 16 matchups", () => {
    const standings = makeStandings(ALL_GROUPS);
    const best = selectBestThirdPlace(standings);
    const bracket = resolveR32Bracket(standings, best);
    expect(bracket.length).toBe(16);
  });

  it("uses group winners for winner slots", () => {
    const standings = makeStandings(ALL_GROUPS);
    const best = selectBestThirdPlace(standings);
    const bracket = resolveR32Bracket(standings, best);

    // Match 73 (index 0): Runner-up A vs Runner-up B
    expect(bracket[0].homeTeamId).toBe("A2");
    expect(bracket[0].awayTeamId).toBe("B2");

    // Match 75 (index 2): Winner F vs Runner-up C
    expect(bracket[2].homeTeamId).toBe("F1");
    expect(bracket[2].awayTeamId).toBe("C2");

    // Match 83 (index 10): Runner-up K vs Runner-up L
    expect(bracket[10].homeTeamId).toBe("K2");
    expect(bracket[10].awayTeamId).toBe("L2");
  });

  it("assigns no duplicate team IDs across all 32 slots", () => {
    const standings = makeStandings(ALL_GROUPS);
    const best = selectBestThirdPlace(standings);
    const bracket = resolveR32Bracket(standings, best);
    const allIds = bracket.flatMap(m => [m.homeTeamId, m.awayTeamId]);
    expect(new Set(allIds).size).toBe(32);
  });

  it("third-place teams come from their slot's eligible groups", () => {
    const standings = makeStandings(ALL_GROUPS);
    const best = selectBestThirdPlace(standings);
    const bracket = resolveR32Bracket(standings, best);

    // Third-place slots are at indices 1,4,6,7,8,9,12,14 (away slots)
    const thirdSlotEligibility: [number, WCGroup[]][] = [
      [1,  ["A","B","C","D","F"]],
      [4,  ["C","D","F","G","H"]],
      [6,  ["C","E","F","H","I"]],
      [7,  ["E","H","I","J","K"]],
      [8,  ["B","E","F","I","J"]],
      [9,  ["A","E","H","I","J"]],
      [12, ["E","F","G","I","J"]],
      [14, ["D","E","I","J","L"]],
    ];

    for (const [idx, eligible] of thirdSlotEligibility) {
      const awayTeamId = bracket[idx].awayTeamId;
      // Team id format is "{group}{position}" e.g. "A3"
      const group = awayTeamId[0] as WCGroup;
      expect(eligible).toContain(group);
    }
  });

  it("throws if group data is missing", () => {
    const standings = makeStandings(["A","B"] as WCGroup[]); // incomplete — missing groups
    const best: TeamStats[] = [];
    expect(() => resolveR32Bracket(standings, best)).toThrow();
  });
});
