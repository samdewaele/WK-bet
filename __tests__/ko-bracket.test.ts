import { describe, it, expect } from "vitest";
import {
  BRACKET_PATH,
  R32_SOURCE_LABELS,
  ROUND_MATCH_NUMBERS,
  BRACKET_POSITIONS,
  BRACKET_COLUMNS,
  BRACKET_LAYOUT,
  BRACKET_CANVAS,
  roundOfMatchNumber,
  computeBracketLayout,
  computeConnectors,
  formatKickoff,
  formatPenalties,
  KO_TBD_ISO,
  NEXT_ROUND_SLOT,
} from "@/lib/ko-bracket";
import { KO_SCHEDULE, koScheduledKickoff } from "@/lib/ko-schedule";
import type { KORound } from "@/lib/pot";

const ALL_KO = Array.from({ length: 32 }, (_, i) => 73 + i); // 73..104

describe("KO bracket topology", () => {
  it("BRACKET_PATH has one entry per match from R16 onward (89..104)", () => {
    expect(Object.keys(BRACKET_PATH).map(Number).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 16 }, (_, i) => 89 + i),
    );
  });

  it("formatKickoff renders TBD for unknown/sentinel/invalid dates, a real time otherwise", () => {
    // Sentinel placeholder the sync loop uses for an unresolved fixture date.
    expect(formatKickoff(KO_TBD_ISO)).toBe("TBD");
    expect(formatKickoff("2026-12-31T00:00:00.000Z")).toBe("TBD");
    expect(formatKickoff("not-a-date")).toBe("TBD");
    expect(formatKickoff("")).toBe("TBD");
    // A real fixture date formats to a non-TBD string carrying the month.
    // (Assert on month, not exact hour, so the test is timezone-independent.)
    const real = formatKickoff("2026-07-14T19:00:00.000Z");
    expect(real).not.toBe("TBD");
    expect(real).toMatch(/Jul/);
  });

  it("formatPenalties renders the shootout score or null", () => {
    expect(formatPenalties(3, 2)).toBe("3-2 pens");
    expect(formatPenalties(0, 0)).toBe("0-0 pens"); // unusual but valid input
    expect(formatPenalties(null, 2)).toBeNull();
    expect(formatPenalties(3, null)).toBeNull();
    expect(formatPenalties(undefined, undefined)).toBeNull();
  });

  it("every BRACKET_PATH feeder references a strictly earlier match", () => {
    for (const [num, path] of Object.entries(BRACKET_PATH)) {
      const parent = Number(num);
      for (const child of [path.home.matchNum, path.away.matchNum]) {
        expect(child).toBeLessThan(parent);
        expect(child).toBeGreaterThanOrEqual(73);
      }
    }
  });

  it("each match feeds the expected number of parent slots", () => {
    const feeders = Object.values(BRACKET_PATH).flatMap((p) => [p.home.matchNum, p.away.matchNum]);
    const counts = new Map<number, number>();
    for (const f of feeders) counts.set(f, (counts.get(f) ?? 0) + 1);
    // 73..100 advance to a single parent each.
    for (let n = 73; n <= 100; n++) expect(counts.get(n)).toBe(1);
    // The two semi-finals split: winner → Final, loser → 3rd place, so each feeds twice.
    expect(counts.get(101)).toBe(2);
    expect(counts.get(102)).toBe(2);
    // The Final and 3rd-place are terminal — never feeders.
    expect(counts.get(103)).toBeUndefined();
    expect(counts.get(104)).toBeUndefined();
  });

  it("matches the official FIFA 2026 R16 + QF feeder pairings (not naive 73+74)", () => {
    // Verified against the published 2026 bracket on Wikipedia.
    const feeders = (n: number) => [BRACKET_PATH[n].home.matchNum, BRACKET_PATH[n].away.matchNum];
    expect(feeders(89)).toEqual([74, 77]);
    expect(feeders(90)).toEqual([73, 75]);
    expect(feeders(91)).toEqual([76, 78]);
    expect(feeders(92)).toEqual([79, 80]);
    expect(feeders(93)).toEqual([83, 84]);
    expect(feeders(94)).toEqual([81, 82]);
    expect(feeders(95)).toEqual([86, 88]);
    expect(feeders(96)).toEqual([85, 87]);
    expect(feeders(97)).toEqual([89, 90]);
    expect(feeders(98)).toEqual([93, 94]);
    expect(feeders(99)).toEqual([91, 92]);
    expect(feeders(100)).toEqual([95, 96]);
    expect(feeders(101)).toEqual([97, 98]);
    expect(feeders(102)).toEqual([99, 100]);
  });

  it("NEXT_ROUND_SLOT is the exact inverse of BRACKET_PATH", () => {
    for (const [parentStr, path] of Object.entries(BRACKET_PATH)) {
      const parent = Number(parentStr);
      for (const side of ["home", "away"] as const) {
        const feeder = path[side];
        const routed = feeder.side === "winner"
          ? NEXT_ROUND_SLOT[feeder.matchNum].winner
          : NEXT_ROUND_SLOT[feeder.matchNum].loser;
        expect(routed).toEqual({ matchNumber: parent, side });
      }
    }
    // Every non-terminal match (73..102) routes its winner somewhere.
    for (let n = 73; n <= 102; n++) expect(NEXT_ROUND_SLOT[n].winner).toBeDefined();
    // Only the semi-finals route a loser (to the 3rd-place match).
    expect(NEXT_ROUND_SLOT[101].loser).toEqual({ matchNumber: 103, side: "home" });
    expect(NEXT_ROUND_SLOT[102].loser).toEqual({ matchNumber: 103, side: "away" });
  });

  it("3rd-place match is fed by the two SF losers; Final by the two SF winners", () => {
    expect(BRACKET_PATH[103]).toEqual({
      home: { matchNum: 101, side: "loser" },
      away: { matchNum: 102, side: "loser" },
    });
    expect(BRACKET_PATH[104]).toEqual({
      home: { matchNum: 101, side: "winner" },
      away: { matchNum: 102, side: "winner" },
    });
  });

  it("R32_SOURCE_LABELS covers all 16 R32 matches", () => {
    expect(Object.keys(R32_SOURCE_LABELS).map(Number).sort((a, b) => a - b)).toEqual(
      ROUND_MATCH_NUMBERS.R32,
    );
  });
});

describe("ROUND_MATCH_NUMBERS + roundOfMatchNumber", () => {
  it("has the canonical per-round counts summing to 32", () => {
    expect(ROUND_MATCH_NUMBERS.R32).toHaveLength(16);
    expect(ROUND_MATCH_NUMBERS.R16).toHaveLength(8);
    expect(ROUND_MATCH_NUMBERS.QF).toHaveLength(4);
    expect(ROUND_MATCH_NUMBERS.SF).toHaveLength(2);
    expect(ROUND_MATCH_NUMBERS["3rd"]).toHaveLength(1);
    expect(ROUND_MATCH_NUMBERS.Final).toHaveLength(1);
    const all = Object.values(ROUND_MATCH_NUMBERS).flat();
    expect(all).toHaveLength(32);
    expect(new Set(all).size).toBe(32); // all unique
    expect([...all].sort((a, b) => a - b)).toEqual(ALL_KO);
  });

  it("maps sample match numbers to the right round", () => {
    expect(roundOfMatchNumber(73)).toBe<KORound>("R32");
    expect(roundOfMatchNumber(88)).toBe<KORound>("R32");
    expect(roundOfMatchNumber(89)).toBe<KORound>("R16");
    expect(roundOfMatchNumber(97)).toBe<KORound>("QF");
    expect(roundOfMatchNumber(101)).toBe<KORound>("SF");
    expect(roundOfMatchNumber(103)).toBe<KORound>("3rd");
    expect(roundOfMatchNumber(104)).toBe<KORound>("Final");
  });

  it("returns null for non-KO match numbers", () => {
    expect(roundOfMatchNumber(1)).toBeNull();
    expect(roundOfMatchNumber(72)).toBeNull();
    expect(roundOfMatchNumber(105)).toBeNull();
  });
});

describe("BRACKET_POSITIONS", () => {
  it("places all 32 matches in columns 0..8", () => {
    expect(Object.keys(BRACKET_POSITIONS).map(Number).sort((a, b) => a - b)).toEqual(ALL_KO);
    for (const pos of Object.values(BRACKET_POSITIONS)) {
      expect(pos.col).toBeGreaterThanOrEqual(0);
      expect(pos.col).toBeLessThan(BRACKET_LAYOUT.COLS);
    }
  });

  it("splits the 16 R32 matches into 8 left (col 0) + 8 right (col 8)", () => {
    const r32 = ROUND_MATCH_NUMBERS.R32;
    const left = r32.filter((n) => BRACKET_POSITIONS[n].col === 0);
    const right = r32.filter((n) => BRACKET_POSITIONS[n].col === 8);
    expect(left).toHaveLength(8);
    expect(right).toHaveLength(8);
    // Each half occupies the 8 vertical slots 0..7 exactly once.
    expect(left.map((n) => BRACKET_POSITIONS[n].slotY).sort((a, b) => a - b))
      .toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(right.map((n) => BRACKET_POSITIONS[n].slotY).sort((a, b) => a - b))
      .toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("puts the Final and 3rd-place in the centre column, Final above 3rd", () => {
    expect(BRACKET_POSITIONS[104].col).toBe(4);
    expect(BRACKET_POSITIONS[103].col).toBe(4);
    expect(BRACKET_POSITIONS[104].slotY).toBeLessThan(BRACKET_POSITIONS[103].slotY);
  });

  it("centres each parent vertically between its two feeders", () => {
    for (const [num, path] of Object.entries(BRACKET_PATH)) {
      if (Number(num) === 103) continue; // 3rd place sits below the final, not centred
      const parentY = BRACKET_POSITIONS[Number(num)].slotY;
      const a = BRACKET_POSITIONS[path.home.matchNum].slotY;
      const b = BRACKET_POSITIONS[path.away.matchNum].slotY;
      expect(parentY).toBeCloseTo((a + b) / 2, 5);
    }
  });
});

describe("computeBracketLayout", () => {
  const layout = computeBracketLayout();

  it("returns all 32 tiles sorted by match number with absolute pixel coords", () => {
    expect(layout.tiles).toHaveLength(32);
    expect(layout.tiles.map((t) => t.matchNumber)).toEqual(ALL_KO);
    const COL_STEP = BRACKET_LAYOUT.TILE_W + BRACKET_LAYOUT.COL_GAP;
    for (const t of layout.tiles) {
      expect(t.x).toBe(t.col * COL_STEP);
      expect(t.width).toBe(BRACKET_LAYOUT.TILE_W);
      expect(t.height).toBe(BRACKET_LAYOUT.TILE_H);
    }
  });

  it("tags tiles with left/center/right and the right round", () => {
    const byNum = new Map(layout.tiles.map((t) => [t.matchNumber, t]));
    expect(byNum.get(73)!.side).toBe("left");
    expect(byNum.get(104)!.side).toBe("center");
    expect(byNum.get(76)!.side).toBe("right");
    expect(byNum.get(104)!.round).toBe<KORound>("Final");
    expect(byNum.get(103)!.round).toBe<KORound>("3rd");
  });

  it("never overlaps two tiles (unique col+y)", () => {
    const seen = new Set<string>();
    for (const t of layout.tiles) {
      const key = `${t.col}:${t.y}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("exposes 9 column headers and a positive canvas matching BRACKET_CANVAS", () => {
    expect(layout.columns).toHaveLength(9);
    expect(layout.columns.map((c) => c.label)).toEqual([
      "R32", "R16", "QF", "SF", "FINAL", "SF", "QF", "R16", "R32",
    ]);
    expect(layout.width).toBe(BRACKET_CANVAS.width);
    expect(layout.height).toBe(BRACKET_CANVAS.height);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });

  it("keeps every tile inside the canvas bounds", () => {
    for (const t of layout.tiles) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.x + t.width).toBeLessThanOrEqual(layout.width);
      expect(t.y + t.height).toBeLessThanOrEqual(layout.height);
    }
  });

  it("column labels match BRACKET_COLUMNS export", () => {
    expect(layout.columns).toEqual(BRACKET_COLUMNS);
  });
});

describe("computeConnectors", () => {
  const connectors = computeConnectors();

  it("emits one connector per (parent, child) feeder pair (32 total)", () => {
    expect(connectors).toHaveLength(32); // 16 parents × 2 feeders
    // Each BRACKET_PATH parent appears exactly twice.
    const perParent = new Map<number, number>();
    for (const c of connectors) perParent.set(c.parent, (perParent.get(c.parent) ?? 0) + 1);
    for (const num of Object.keys(BRACKET_PATH).map(Number)) {
      expect(perParent.get(num)).toBe(2);
    }
  });

  it("draws orthogonal 4-point polylines (each segment is horizontal or vertical)", () => {
    for (const c of connectors) {
      expect(c.points).toHaveLength(4);
      for (let i = 1; i < c.points.length; i++) {
        const a = c.points[i - 1];
        const b = c.points[i];
        const sameX = Math.abs(a.x - b.x) < 1e-9;
        const sameY = Math.abs(a.y - b.y) < 1e-9;
        expect(sameX || sameY).toBe(true);
      }
    }
  });

  it("starts at the child's near edge and ends at the parent's near edge", () => {
    const COL_STEP = BRACKET_LAYOUT.TILE_W + BRACKET_LAYOUT.COL_GAP;
    for (const c of connectors) {
      const childCol = BRACKET_POSITIONS[c.child].col;
      const parentCol = BRACKET_POSITIONS[c.parent].col;
      const childOnLeft = childCol < parentCol;
      const start = c.points[0];
      const end = c.points[c.points.length - 1];
      const expectedChildEdge = childOnLeft
        ? childCol * COL_STEP + BRACKET_LAYOUT.TILE_W // right edge
        : childCol * COL_STEP; // left edge
      const expectedParentEdge = childOnLeft
        ? parentCol * COL_STEP // left edge
        : parentCol * COL_STEP + BRACKET_LAYOUT.TILE_W; // right edge
      expect(start.x).toBeCloseTo(expectedChildEdge, 5);
      expect(end.x).toBeCloseTo(expectedParentEdge, 5);
    }
  });

  it("connects the centre Final to one left SF and one right SF", () => {
    const finalConns = connectors.filter((c) => c.parent === 104);
    expect(finalConns.map((c) => c.child).sort((a, b) => a - b)).toEqual([101, 102]);
    const sf101 = finalConns.find((c) => c.child === 101)!;
    const sf102 = finalConns.find((c) => c.child === 102)!;
    // 101 is on the left of the final, 102 on the right
    expect(sf101.points[0].x).toBeLessThan(sf102.points[0].x);
  });
});

describe("KO_SCHEDULE (official static kickoff times)", () => {
  it("covers every KO match number 73..104 with a valid UTC ISO date", () => {
    expect(Object.keys(KO_SCHEDULE).map(Number).sort((a, b) => a - b)).toEqual(ALL_KO);
    for (const iso of Object.values(KO_SCHEDULE)) {
      expect(iso).toMatch(/^2026-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      expect(Number.isNaN(new Date(iso).getTime())) .toBe(false);
    }
  });

  it("is chronologically consistent with the bracket — a match never precedes its feeders", () => {
    for (const [parentStr, path] of Object.entries(BRACKET_PATH)) {
      const parent = Number(parentStr);
      const pT = new Date(KO_SCHEDULE[parent]).getTime();
      for (const child of [path.home.matchNum, path.away.matchNum]) {
        expect(pT).toBeGreaterThan(new Date(KO_SCHEDULE[child]).getTime());
      }
    }
  });

  it("anchors known fixtures to the right slot (R32 73 = 28 Jun, Final 104 = 19 Jul)", () => {
    expect(KO_SCHEDULE[73]).toBe("2026-06-28T19:00:00Z"); // South Africa v Canada
    expect(KO_SCHEDULE[104]).toBe("2026-07-19T19:00:00Z"); // Final
    expect(koScheduledKickoff(73)).toBe(KO_SCHEDULE[73]);
    expect(koScheduledKickoff(1)).toBeNull();
    expect(koScheduledKickoff(null)).toBeNull();
  });
});
