import { describe, it, expect } from "vitest";
import { computeActualStandings } from "@/lib/group-standings";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const BRA = { id: "bra", name: "Brazil", flag: "🇧🇷" };
const GER = { id: "ger", name: "Germany", flag: "🇩🇪" };
const FRA = { id: "fra", name: "France", flag: "🇫🇷" };
const ESP = { id: "esp", name: "Spain", flag: "🇪🇸" };

function match(
  homeTeam: typeof BRA,
  awayTeam: typeof BRA,
  homeScore: number | null,
  awayScore: number | null,
  opts: { group?: string; status?: string } = {}
) {
  return {
    group: opts.group ?? "A",
    homeTeam,
    awayTeam,
    homeScore,
    awayScore,
    status: opts.status ?? "finished",
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("computeActualStandings — basic filtering", () => {
  it("returns empty map for empty input", () => {
    expect(computeActualStandings([])).toEqual(new Map());
  });

  it("ignores matches that are not finished", () => {
    const result = computeActualStandings([
      match(BRA, GER, 2, 1, { status: "live" }),
      match(BRA, GER, 2, 1, { status: "scheduled" }),
    ]);
    expect(result.size).toBe(0);
  });

  it("ignores finished matches with null homeScore", () => {
    const result = computeActualStandings([match(BRA, GER, null, 1)]);
    expect(result.size).toBe(0);
  });

  it("ignores finished matches with null awayScore", () => {
    const result = computeActualStandings([match(BRA, GER, 2, null)]);
    expect(result.size).toBe(0);
  });

  it("ignores matches with null homeTeam", () => {
    const result = computeActualStandings([
      { group: "A", homeTeam: null, awayTeam: GER, homeScore: 2, awayScore: 1, status: "finished" },
    ]);
    expect(result.size).toBe(0);
  });

  it("ignores matches with null awayTeam", () => {
    const result = computeActualStandings([
      { group: "A", homeTeam: BRA, awayTeam: null, homeScore: 2, awayScore: 1, status: "finished" },
    ]);
    expect(result.size).toBe(0);
  });

  it("ignores matches with null group", () => {
    const result = computeActualStandings([
      { group: null, homeTeam: BRA, awayTeam: GER, homeScore: 2, awayScore: 1, status: "finished" },
    ]);
    expect(result.size).toBe(0);
  });
});

describe("computeActualStandings — points and W/D/L", () => {
  it("home win: home gets 3 pts + 1W, away gets 0 pts + 1L", () => {
    const result = computeActualStandings([match(BRA, GER, 2, 1)]);
    const standings = result.get("A")!;
    const bra = standings.find((s) => s.teamId === "bra")!;
    const ger = standings.find((s) => s.teamId === "ger")!;

    expect(bra.pts).toBe(3);
    expect(bra.w).toBe(1);
    expect(bra.d).toBe(0);
    expect(bra.l).toBe(0);

    expect(ger.pts).toBe(0);
    expect(ger.w).toBe(0);
    expect(ger.d).toBe(0);
    expect(ger.l).toBe(1);
  });

  it("away win: away gets 3 pts + 1W, home gets 0 pts + 1L", () => {
    const result = computeActualStandings([match(BRA, GER, 0, 1)]);
    const standings = result.get("A")!;
    const bra = standings.find((s) => s.teamId === "bra")!;
    const ger = standings.find((s) => s.teamId === "ger")!;

    expect(bra.pts).toBe(0);
    expect(bra.l).toBe(1);
    expect(ger.pts).toBe(3);
    expect(ger.w).toBe(1);
  });

  it("draw: both get 1 pt + 1D", () => {
    const result = computeActualStandings([match(BRA, GER, 1, 1)]);
    const standings = result.get("A")!;
    const bra = standings.find((s) => s.teamId === "bra")!;
    const ger = standings.find((s) => s.teamId === "ger")!;

    expect(bra.pts).toBe(1);
    expect(bra.d).toBe(1);
    expect(ger.pts).toBe(1);
    expect(ger.d).toBe(1);
  });

  it("0-0 draw: both get 1 pt", () => {
    const result = computeActualStandings([match(BRA, GER, 0, 0)]);
    const standings = result.get("A")!;
    expect(standings.every((s) => s.pts === 1)).toBe(true);
  });
});

describe("computeActualStandings — goal difference and goals for", () => {
  it("home win 3-1: home gd=+2 gf=3, away gd=-2 gf=1", () => {
    const result = computeActualStandings([match(BRA, GER, 3, 1)]);
    const standings = result.get("A")!;
    const bra = standings.find((s) => s.teamId === "bra")!;
    const ger = standings.find((s) => s.teamId === "ger")!;

    expect(bra.gd).toBe(2);
    expect(bra.gf).toBe(3);
    expect(ger.gd).toBe(-2);
    expect(ger.gf).toBe(1);
  });

  it("accumulates gf across multiple matches", () => {
    const result = computeActualStandings([
      match(BRA, GER, 2, 0),
      match(BRA, FRA, 1, 1, { group: "A" }),
    ]);
    const standings = result.get("A")!;
    const bra = standings.find((s) => s.teamId === "bra")!;
    expect(bra.gf).toBe(3); // 2 + 1
  });
});

describe("computeActualStandings — accumulation across multiple matches", () => {
  it("accumulates points across 3 matches for the same team", () => {
    const result = computeActualStandings([
      match(BRA, GER, 2, 0),    // BRA win: 3 pts
      match(BRA, FRA, 1, 1),    // BRA draw: 1 pt
      match(BRA, ESP, 0, 1),    // BRA loss: 0 pts
    ]);
    const standings = result.get("A")!;
    const bra = standings.find((s) => s.teamId === "bra")!;
    expect(bra.pts).toBe(4);
    expect(bra.w).toBe(1);
    expect(bra.d).toBe(1);
    expect(bra.l).toBe(1);
  });

  it("includes all teams that appeared in finished matches", () => {
    const result = computeActualStandings([
      match(BRA, GER, 1, 0),
      match(FRA, ESP, 2, 2),
    ]);
    const standings = result.get("A")!;
    expect(standings).toHaveLength(4);
  });
});

describe("computeActualStandings — sorting", () => {
  it("sorts by pts descending", () => {
    // BRA: 4pts (+3gd), FRA: 4pts (+2gd), ESP: 1pt (-1gd), GER: 1pt (-2gd)
    const result = computeActualStandings([
      match(BRA, GER, 3, 0),  // BRA win: +3gd
      match(FRA, ESP, 2, 0),  // FRA win: +2gd
      match(BRA, FRA, 0, 0),  // draw: BRA 4pts, FRA 4pts
      match(GER, ESP, 1, 1),  // draw: GER 1pt(-2gd), ESP 1pt(-1gd)
    ]);
    const standings = result.get("A")!;
    expect(standings[0].teamId).toBe("bra");           // 4pts, +3gd
    expect(standings[1].teamId).toBe("fra");           // 4pts, +2gd
    expect(standings[standings.length - 1].teamId).toBe("ger"); // 1pt, -2gd (worst)
  });

  it("breaks pts tie by goal difference", () => {
    // Both teams get 3 pts but different GDs
    const result = computeActualStandings([
      match(BRA, GER, 3, 0),  // BRA: 3pts, +3 gd
      match(FRA, ESP, 1, 0),  // FRA: 3pts, +1 gd
      match(BRA, FRA, 0, 0),  // BRA: +1 more pt (draw), FRA: +1 more pt
    ]);
    const standings = result.get("A")!;
    const bra = standings.find((s) => s.teamId === "bra")!;
    const fra = standings.find((s) => s.teamId === "fra")!;
    // BRA: 4pts, +3 gd; FRA: 4pts, +1 gd
    expect(bra.pts).toBe(4);
    expect(fra.pts).toBe(4);
    const braIdx = standings.indexOf(bra);
    const fraIdx = standings.indexOf(fra);
    expect(braIdx).toBeLessThan(fraIdx);
  });

  it("breaks pts+gd tie by goals for", () => {
    // Both teams get 3 pts, same GD but different GF
    const result = computeActualStandings([
      match(BRA, GER, 3, 1),  // BRA: 3pts, gd+2, gf=3
      match(FRA, ESP, 2, 0),  // FRA: 3pts, gd+2, gf=2
    ]);
    const standings = result.get("A")!;
    const bra = standings.find((s) => s.teamId === "bra")!;
    const fra = standings.find((s) => s.teamId === "fra")!;
    expect(bra.pts).toBe(fra.pts);
    expect(bra.gd).toBe(fra.gd);
    expect(bra.gf).toBeGreaterThan(fra.gf);
    expect(standings.indexOf(bra)).toBeLessThan(standings.indexOf(fra));
  });
});

describe("computeActualStandings — multiple groups", () => {
  it("separates groups correctly", () => {
    const result = computeActualStandings([
      match(BRA, GER, 2, 0, { group: "A" }),
      match(FRA, ESP, 1, 3, { group: "B" }),
    ]);
    expect(result.has("A")).toBe(true);
    expect(result.has("B")).toBe(true);
    expect(result.get("A")).toHaveLength(2);
    expect(result.get("B")).toHaveLength(2);
  });

  it("does not mix teams across groups", () => {
    const result = computeActualStandings([
      match(BRA, GER, 1, 0, { group: "A" }),
      match(FRA, ESP, 1, 0, { group: "B" }),
    ]);
    const groupA = result.get("A")!;
    expect(groupA.map((s) => s.teamId)).not.toContain("fra");
    expect(groupA.map((s) => s.teamId)).not.toContain("esp");
  });
});

describe("computeActualStandings — mixed finished and non-finished", () => {
  it("only counts finished matches, ignores live/scheduled", () => {
    const result = computeActualStandings([
      match(BRA, GER, 2, 0, { status: "finished" }),
      match(BRA, FRA, 3, 0, { status: "live" }),       // should not count
      match(GER, FRA, 1, 1, { status: "scheduled" }),  // should not count
    ]);
    const standings = result.get("A")!;
    const bra = standings.find((s) => s.teamId === "bra")!;
    expect(bra.pts).toBe(3);  // only 1 win counted, not the live match
    expect(bra.gf).toBe(2);
    // FRA and GER should not appear (only appeared in non-finished matches)
    expect(standings.find((s) => s.teamId === "fra")).toBeUndefined();
  });
});
