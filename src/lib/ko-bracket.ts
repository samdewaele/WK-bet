import type { KORound } from "./pot";

// ─────────────────────────────────────────────────────────────────────────────
// KO bracket topology — the single source of truth for how the 32 knockout
// matches (numbered 73‑104) connect. Shared by the prediction editor, the
// visual bracket, and the bracket layout math below.
// ─────────────────────────────────────────────────────────────────────────────

export type BracketSide = "winner" | "loser";

/**
 * For every match from R16 onward: which earlier match feeds its home/away slot,
 * and whether the winner or loser advances. R32 matches (73‑88) are fed directly
 * by group qualifiers (see ko-seeding.ts) and have no entry here.
 */
export const BRACKET_PATH: Record<
  number,
  { home: { matchNum: number; side: BracketSide }; away: { matchNum: number; side: BracketSide } }
> = {
  89:  { home: { matchNum: 73, side: "winner" }, away: { matchNum: 74, side: "winner" } },
  90:  { home: { matchNum: 75, side: "winner" }, away: { matchNum: 76, side: "winner" } },
  91:  { home: { matchNum: 77, side: "winner" }, away: { matchNum: 78, side: "winner" } },
  92:  { home: { matchNum: 79, side: "winner" }, away: { matchNum: 80, side: "winner" } },
  93:  { home: { matchNum: 81, side: "winner" }, away: { matchNum: 82, side: "winner" } },
  94:  { home: { matchNum: 83, side: "winner" }, away: { matchNum: 84, side: "winner" } },
  95:  { home: { matchNum: 85, side: "winner" }, away: { matchNum: 86, side: "winner" } },
  96:  { home: { matchNum: 87, side: "winner" }, away: { matchNum: 88, side: "winner" } },
  97:  { home: { matchNum: 89, side: "winner" }, away: { matchNum: 90, side: "winner" } },
  98:  { home: { matchNum: 91, side: "winner" }, away: { matchNum: 92, side: "winner" } },
  99:  { home: { matchNum: 93, side: "winner" }, away: { matchNum: 94, side: "winner" } },
  100: { home: { matchNum: 95, side: "winner" }, away: { matchNum: 96, side: "winner" } },
  101: { home: { matchNum: 97,  side: "winner" }, away: { matchNum: 98,  side: "winner" } },
  102: { home: { matchNum: 99,  side: "winner" }, away: { matchNum: 100, side: "winner" } },
  103: { home: { matchNum: 101, side: "loser"  }, away: { matchNum: 102, side: "loser"  } },
  104: { home: { matchNum: 101, side: "winner" }, away: { matchNum: 102, side: "winner" } },
};

/**
 * Static source labels for each R32 match slot (matchNumber → home/away label).
 * Derived from the official FIFA WC 2026 bracket seeding rules in ko-seeding.ts.
 */
export const R32_SOURCE_LABELS: Record<number, { home: string; away: string }> = {
  73:  { home: "2nd A",                   away: "2nd B" },
  74:  { home: "1st E",                   away: "Best 3rd (A/B/C/D/F)" },
  75:  { home: "1st F",                   away: "2nd C" },
  76:  { home: "1st C",                   away: "2nd F" },
  77:  { home: "1st I",                   away: "Best 3rd (C/D/F/G/H)" },
  78:  { home: "2nd E",                   away: "2nd I" },
  79:  { home: "1st A",                   away: "Best 3rd (C/E/F/H/I)" },
  80:  { home: "1st L",                   away: "Best 3rd (E/H/I/J/K)" },
  81:  { home: "1st D",                   away: "Best 3rd (B/E/F/I/J)" },
  82:  { home: "1st G",                   away: "Best 3rd (A/E/H/I/J)" },
  83:  { home: "2nd K",                   away: "2nd L" },
  84:  { home: "1st H",                   away: "2nd J" },
  85:  { home: "1st B",                   away: "Best 3rd (E/F/G/I/J)" },
  86:  { home: "1st J",                   away: "2nd H" },
  87:  { home: "1st K",                   away: "Best 3rd (D/E/I/J/L)" },
  88:  { home: "2nd D",                   away: "2nd G" },
};

/** Which match numbers belong to each KO round. */
export const ROUND_MATCH_NUMBERS: Record<KORound, number[]> = {
  R32:   [73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88],
  R16:   [89, 90, 91, 92, 93, 94, 95, 96],
  QF:    [97, 98, 99, 100],
  SF:    [101, 102],
  "3rd": [103],
  Final: [104],
};

const MATCH_NUMBER_TO_ROUND: Record<number, KORound> = (() => {
  const map: Record<number, KORound> = {};
  for (const round of Object.keys(ROUND_MATCH_NUMBERS) as KORound[]) {
    for (const n of ROUND_MATCH_NUMBERS[round]) map[n] = round;
  }
  return map;
})();

/** The KO round a match number belongs to, or null if it isn't a KO match. */
export function roundOfMatchNumber(matchNumber: number): KORound | null {
  return MATCH_NUMBER_TO_ROUND[matchNumber] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Visual bracket layout
//
// A classic two‑sided tournament tree: the left half flows R32 → R16 → QF → SF
// inward, the right half mirrors it, and the Final (with the 3rd‑place match
// tucked beneath it) sits in the centre column.
//
//   col:   0      1     2    3        4        5     6     7      8
//          R32 →  R16 → QF → SF →  FINAL/3rd ← SF ← QF ← R16 ← R32
//
// Positions are expressed as (col, slotY) grid units, then converted to pixels.
// ─────────────────────────────────────────────────────────────────────────────

export const BRACKET_LAYOUT = {
  TILE_W: 132,
  TILE_H: 56,
  COL_GAP: 32,
  SLOT: 72, // vertical grid unit (one R32 match per slot)
  COLS: 9,
} as const;

const COL_STEP = BRACKET_LAYOUT.TILE_W + BRACKET_LAYOUT.COL_GAP;

/** (col, slotY) grid coordinate of every KO match. */
export const BRACKET_POSITIONS: Record<number, { col: number; slotY: number }> = {
  // Left half — R32
  73: { col: 0, slotY: 0 }, 74: { col: 0, slotY: 1 }, 75: { col: 0, slotY: 2 }, 76: { col: 0, slotY: 3 },
  77: { col: 0, slotY: 4 }, 78: { col: 0, slotY: 5 }, 79: { col: 0, slotY: 6 }, 80: { col: 0, slotY: 7 },
  // Left half — R16 (centred between its two R32 feeders)
  89: { col: 1, slotY: 0.5 }, 90: { col: 1, slotY: 2.5 }, 91: { col: 1, slotY: 4.5 }, 92: { col: 1, slotY: 6.5 },
  // Left half — QF
  97: { col: 2, slotY: 1.5 }, 98: { col: 2, slotY: 5.5 },
  // Left half — SF
  101: { col: 3, slotY: 3.5 },
  // Centre — Final + 3rd place
  104: { col: 4, slotY: 3.5 },
  103: { col: 4, slotY: 5.5 },
  // Right half — SF
  102: { col: 5, slotY: 3.5 },
  // Right half — QF
  99: { col: 6, slotY: 1.5 }, 100: { col: 6, slotY: 5.5 },
  // Right half — R16
  93: { col: 7, slotY: 0.5 }, 94: { col: 7, slotY: 2.5 }, 95: { col: 7, slotY: 4.5 }, 96: { col: 7, slotY: 6.5 },
  // Right half — R32
  81: { col: 8, slotY: 0 }, 82: { col: 8, slotY: 1 }, 83: { col: 8, slotY: 2 }, 84: { col: 8, slotY: 3 },
  85: { col: 8, slotY: 4 }, 86: { col: 8, slotY: 5 }, 87: { col: 8, slotY: 6 }, 88: { col: 8, slotY: 7 },
};

export type BracketColumn = {
  col: number;
  x: number;
  round: KORound;
  /** Compact header used in the column strip, e.g. "R32", "QF", "FINAL". */
  label: string;
  side: "left" | "center" | "right";
};

/** Compact round headers per column, left → right. */
export const BRACKET_COLUMNS: BracketColumn[] = [
  { col: 0, x: 0 * COL_STEP, round: "R32", label: "R32", side: "left" },
  { col: 1, x: 1 * COL_STEP, round: "R16", label: "R16", side: "left" },
  { col: 2, x: 2 * COL_STEP, round: "QF", label: "QF", side: "left" },
  { col: 3, x: 3 * COL_STEP, round: "SF", label: "SF", side: "left" },
  { col: 4, x: 4 * COL_STEP, round: "Final", label: "FINAL", side: "center" },
  { col: 5, x: 5 * COL_STEP, round: "SF", label: "SF", side: "right" },
  { col: 6, x: 6 * COL_STEP, round: "QF", label: "QF", side: "right" },
  { col: 7, x: 7 * COL_STEP, round: "R16", label: "R16", side: "right" },
  { col: 8, x: 8 * COL_STEP, round: "R32", label: "R32", side: "right" },
];

export type PositionedTile = {
  matchNumber: number;
  round: KORound;
  col: number;
  /** Pixel position of the tile's top‑left corner. */
  x: number;
  y: number;
  width: number;
  height: number;
  side: "left" | "center" | "right";
};

function tileSide(col: number): "left" | "center" | "right" {
  if (col < 4) return "left";
  if (col === 4) return "center";
  return "right";
}

/** Canvas pixel dimensions of the whole bracket. */
export const BRACKET_CANVAS = {
  width: (BRACKET_LAYOUT.COLS - 1) * COL_STEP + BRACKET_LAYOUT.TILE_W,
  height: 7 * BRACKET_LAYOUT.SLOT + BRACKET_LAYOUT.TILE_H, // tallest column is R32 (slotY 0‑7)
} as const;

/** Every KO match placed at its absolute pixel position. */
export function computeBracketLayout(): {
  tiles: PositionedTile[];
  columns: BracketColumn[];
  width: number;
  height: number;
} {
  const tiles: PositionedTile[] = Object.entries(BRACKET_POSITIONS).map(([num, pos]) => {
    const matchNumber = Number(num);
    return {
      matchNumber,
      round: roundOfMatchNumber(matchNumber)!,
      col: pos.col,
      x: pos.col * COL_STEP,
      y: pos.slotY * BRACKET_LAYOUT.SLOT,
      width: BRACKET_LAYOUT.TILE_W,
      height: BRACKET_LAYOUT.TILE_H,
      side: tileSide(pos.col),
    };
  });
  tiles.sort((a, b) => a.matchNumber - b.matchNumber);
  return { tiles, columns: BRACKET_COLUMNS, width: BRACKET_CANVAS.width, height: BRACKET_CANVAS.height };
}

export type Point = { x: number; y: number };
export type Connector = { parent: number; child: number; points: Point[] };

function tileMidY(matchNumber: number): number {
  return BRACKET_POSITIONS[matchNumber].slotY * BRACKET_LAYOUT.SLOT + BRACKET_LAYOUT.TILE_H / 2;
}
function tileLeftX(matchNumber: number): number {
  return BRACKET_POSITIONS[matchNumber].col * COL_STEP;
}
function tileRightX(matchNumber: number): number {
  return tileLeftX(matchNumber) + BRACKET_LAYOUT.TILE_W;
}

/**
 * Orthogonal connector polylines linking each child match to its parent.
 * Each polyline runs: child edge → gutter → (vertical) → parent edge, so two
 * siblings meet at the parent's mid‑height. Works for both halves and the
 * centre column by orienting off the child/parent column order.
 */
export function computeConnectors(): Connector[] {
  const connectors: Connector[] = [];
  for (const [num, path] of Object.entries(BRACKET_PATH)) {
    const parent = Number(num);
    const pCol = BRACKET_POSITIONS[parent].col;
    for (const child of [path.home.matchNum, path.away.matchNum]) {
      const cCol = BRACKET_POSITIONS[child].col;
      const childOnLeft = cCol < pCol;
      const childEdgeX = childOnLeft ? tileRightX(child) : tileLeftX(child);
      const parentEdgeX = childOnLeft ? tileLeftX(parent) : tileRightX(parent);
      const gutterX = (childEdgeX + parentEdgeX) / 2;
      connectors.push({
        parent,
        child,
        points: [
          { x: childEdgeX, y: tileMidY(child) },
          { x: gutterX, y: tileMidY(child) },
          { x: gutterX, y: tileMidY(parent) },
          { x: parentEdgeX, y: tileMidY(parent) },
        ],
      });
    }
  }
  return connectors;
}
