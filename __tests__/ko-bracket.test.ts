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
} from "@/lib/ko-bracket";
import type { KORound } from "@/lib/pot";

const ALL_KO = Array.from({ length: 32 }, (_, i) => 73 + i); // 73..104

describe("KO bracket topology", () => {
  it("BRACKET_PATH has one entry per match from R16 onward (89..104)", () => {
    expect(Object.keys(BRACKET_PATH).map(Number).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 16 }, (_, i) => 89 + i),
    );
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

  it("mirrors left and right halves at equal slotY (e.g. R32 73 ↔ 81)", () => {
    expect(BRACKET_POSITIONS[73]).toEqual({ col: 0, slotY: 0 });
    expect(BRACKET_POSITIONS[81]).toEqual({ col: 8, slotY: 0 });
    expect(BRACKET_POSITIONS[73].slotY).toBe(BRACKET_POSITIONS[81].slotY);
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
    expect(byNum.get(81)!.side).toBe("right");
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
