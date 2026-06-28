import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    groupStandingPrediction: { findMany: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    kOPrediction: { findMany: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    match: { findMany: vi.fn() },
  },
}));

import { db } from "@/lib/db";
import { scoreRoomGroupStanding, scoreRoomKOMatch } from "@/lib/scoring";

const mockDb = db as any;

/** Map captured update() calls → { id: earnedAmount }. */
function earnedById(updateMock: any): Record<string, number> {
  const out: Record<string, number> = {};
  for (const call of updateMock.mock.calls) {
    out[call[0].where.id] = call[0].data.earnedAmount;
  }
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.groupStandingPrediction.update.mockResolvedValue({});
  mockDb.kOPrediction.update.mockResolvedValue({});
  // Default: single R32 match with fixed teams, no other rounds
  mockDb.match.findMany.mockResolvedValue([
    { id: "m1", matchNumber: 73, homeTeamId: "tA", awayTeamId: "tB" },
  ]);
});

// ---------------------------------------------------------------------------
// Group standings
// ---------------------------------------------------------------------------

const ACTUAL: [string, string, string, string] = ["A", "B", "C", "D"];

function gp(id: string, p: [string, string, string, string]) {
  return { id, position1: p[0], position2: p[1], position3: p[2], position4: p[3] };
}

describe("scoreRoomGroupStanding — top tier wins, split within tier", () => {
  it("sole perfect prediction takes the whole group prize", async () => {
    mockDb.groupStandingPrediction.findMany.mockResolvedValue([
      gp("perfect", ["A", "B", "C", "D"]),
      gp("top2", ["A", "B", "X", "Y"]),
      gp("wrong", ["D", "C", "B", "A"]),
    ]);

    await scoreRoomGroupStanding("r1", "A", ACTUAL, 120);

    const earned = earnedById(mockDb.groupStandingPrediction.update);
    expect(earned.perfect).toBe(120);   // 1.0 tier, sole winner
    expect(earned.top2).toBe(0);        // below top tier
    expect(earned.wrong).toBe(0);
  });

  it("two perfect predictions split the group prize equally", async () => {
    mockDb.groupStandingPrediction.findMany.mockResolvedValue([
      gp("p1", ["A", "B", "C", "D"]),
      gp("p2", ["A", "B", "C", "D"]),
      gp("p3", ["A", "B", "D", "C"]), // top2 only
    ]);

    await scoreRoomGroupStanding("r1", "A", ACTUAL, 120);

    const earned = earnedById(mockDb.groupStandingPrediction.update);
    expect(earned.p1).toBe(60);
    expect(earned.p2).toBe(60);
    expect(earned.p3).toBe(0);
  });

  it("when nobody is perfect, the best (top-2) tier wins", async () => {
    mockDb.groupStandingPrediction.findMany.mockResolvedValue([
      gp("top2a", ["A", "B", "D", "C"]),
      gp("top2b", ["A", "B", "X", "Y"]),
      gp("firstOnly", ["A", "X", "Y", "Z"]),
    ]);

    await scoreRoomGroupStanding("r1", "A", ACTUAL, 120);

    const earned = earnedById(mockDb.groupStandingPrediction.update);
    // 0.75 multiplier, two winners → (120 * 0.75) / 2 = 45 each
    expect(earned.top2a).toBeCloseTo(45);
    expect(earned.top2b).toBeCloseTo(45);
    expect(earned.firstOnly).toBe(0);
  });

  it("nobody scores → everyone earns 0 (money flows to uber pot)", async () => {
    mockDb.groupStandingPrediction.findMany.mockResolvedValue([
      gp("x", ["D", "C", "B", "A"]),
      gp("y", ["C", "D", "A", "B"]),
    ]);

    await scoreRoomGroupStanding("r1", "A", ACTUAL, 120);

    const earned = earnedById(mockDb.groupStandingPrediction.update);
    expect(earned.x).toBe(0);
    expect(earned.y).toBe(0);
  });

  it("never pays out more than the group prize", async () => {
    mockDb.groupStandingPrediction.findMany.mockResolvedValue([
      gp("p1", ["A", "B", "C", "D"]),
      gp("p2", ["A", "B", "C", "D"]),
      gp("p3", ["A", "B", "C", "D"]),
    ]);

    await scoreRoomGroupStanding("r1", "A", ACTUAL, 120);

    const earned = earnedById(mockDb.groupStandingPrediction.update);
    const total = Object.values(earned).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(120);
  });
});

// ---------------------------------------------------------------------------
// KO matches — R32 (teams fixed, same as actual for all players)
// ---------------------------------------------------------------------------

// For R32, all players see the same actual teams (tA vs tB). Scoring reduces
// to: did you predict the right 90-minute winner?

function ko(id: string, userId: string, matchId: string, home: number, away: number) {
  return { id, userId, matchId, homeScore: home, awayScore: away };
}

describe("scoreRoomKOMatch — R32 (team-aware, same teams for all)", () => {
  it("sole exact score takes the whole match prize", async () => {
    mockDb.kOPrediction.findMany.mockResolvedValue([
      ko("exact", "u1", "m1", 2, 0),
      ko("winner", "u2", "m1", 1, 0),
      ko("wrong", "u3", "m1", 0, 1),
    ]);

    await scoreRoomKOMatch("r1", "m1", "R32", 80, 2, 0);

    const earned = earnedById(mockDb.kOPrediction.update);
    expect(earned.exact).toBe(80);
    expect(earned.winner).toBe(0);
    expect(earned.wrong).toBe(0);
  });

  it("with no exact score, correct-winner tier splits the prize", async () => {
    mockDb.kOPrediction.findMany.mockResolvedValue([
      ko("w1", "u1", "m1", 1, 0),
      ko("w2", "u2", "m1", 3, 0),
      ko("wrong", "u3", "m1", 0, 2),
    ]);

    await scoreRoomKOMatch("r1", "m1", "R32", 80, 2, 0);

    const earned = earnedById(mockDb.kOPrediction.update);
    // 0.75 multiplier, two winners → (80 * 0.75) / 2 = 30 each
    expect(earned.w1).toBeCloseTo(30);
    expect(earned.w2).toBeCloseTo(30);
    expect(earned.wrong).toBe(0);
  });

  it("also writes accuracy points", async () => {
    mockDb.kOPrediction.findMany.mockResolvedValue([ko("exact", "u1", "m1", 2, 0)]);
    await scoreRoomKOMatch("r1", "m1", "R32", 80, 2, 0);
    const call = mockDb.kOPrediction.update.mock.calls[0][0];
    expect(call.data.points).toBeGreaterThan(0);
  });

  it("does nothing when there are no predictions", async () => {
    mockDb.kOPrediction.findMany.mockResolvedValue([]);
    await scoreRoomKOMatch("r1", "m1", "R32", 80, 2, 0);
    expect(mockDb.kOPrediction.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// KO matches — team-aware: wrong bracket prediction earns 0
// ---------------------------------------------------------------------------
// NEXT_ROUND_SLOT[74] = { winner: { matchNumber: 89, side: "home" } }
// so the winner of R32 match #74 becomes the home team in R16 match #89 (official tree).

describe("scoreRoomKOMatch — team-aware bracket scoring (R16)", () => {
  beforeEach(() => {
    // Two matches: R32 #74 (tA vs tB) and R16 #89 (actual home=tA, away=tC).
    // Official tree: winner of #74 feeds #89's home slot.
    mockDb.match.findMany.mockResolvedValue([
      { id: "m74", matchNumber: 74, homeTeamId: "tA", awayTeamId: "tB" },
      { id: "m89", matchNumber: 89, homeTeamId: "tA", awayTeamId: "tC" },
    ]);
  });

  it("awards full prize when player predicted the correct team to advance AND exact score", async () => {
    mockDb.kOPrediction.findMany.mockResolvedValue([
      // u1 correctly predicted tA to win R32 (home wins 2-0)
      ko("u1_r32", "u1", "m74", 2, 0),
      // u1 predicts 2-1 in the R16 match → tA (home) wins → exact score
      ko("u1_r16", "u1", "m89", 2, 1),
    ]);

    // Actual R16 result: tA wins 2-1
    await scoreRoomKOMatch("r1", "m89", "R16", 80, 2, 1);

    const earned = earnedById(mockDb.kOPrediction.update);
    expect(earned["u1_r16"]).toBe(80); // exact score + correct team = 1.0x = 80
  });

  it("awards 0 when player predicted the wrong team to advance, even if score digits match", async () => {
    mockDb.kOPrediction.findMany.mockResolvedValue([
      // u2 wrongly predicted tB to win R32 (away wins 0-2) → tB in R16 home slot
      ko("u2_r32", "u2", "m74", 0, 2),
      // u2 predicts 2-1 in R16 → predicted home (tB) wins, but actual home is tA
      ko("u2_r16", "u2", "m89", 2, 1),
    ]);

    // Actual R16 result: tA wins 2-1 (same score, wrong team)
    await scoreRoomKOMatch("r1", "m89", "R16", 80, 2, 1);

    const earned = earnedById(mockDb.kOPrediction.update);
    expect(earned["u2_r16"]).toBe(0); // correct score digits but wrong team → 0
  });

  it("correct winner, wrong exact score → 0.75x partial prize", async () => {
    mockDb.kOPrediction.findMany.mockResolvedValue([
      ko("u1_r32", "u1", "m74", 2, 0), // correctly predicted tA to advance
      ko("u1_r16", "u1", "m89", 3, 1), // correct winner (tA) but wrong score
    ]);

    // Actual: tA wins 2-1
    await scoreRoomKOMatch("r1", "m89", "R16", 80, 2, 1);

    const earned = earnedById(mockDb.kOPrediction.update);
    expect(earned["u1_r16"]).toBe(60); // 0.75 × 80 = 60
  });

  it("two players: one correct team, one wrong — only correct team player earns", async () => {
    mockDb.kOPrediction.findMany.mockResolvedValue([
      ko("u1_r32", "u1", "m74", 2, 0), // tA wins R32
      ko("u1_r16", "u1", "m89", 3, 0), // correct winner (tA), wrong score → 0.75x
      ko("u2_r32", "u2", "m74", 0, 2), // tB "wins" R32 in u2's prediction
      ko("u2_r16", "u2", "m89", 3, 0), // same score, but wrong team in bracket → 0
    ]);

    // Actual: tA wins 2-1
    await scoreRoomKOMatch("r1", "m89", "R16", 80, 2, 1);

    const earned = earnedById(mockDb.kOPrediction.update);
    expect(earned["u1_r16"]).toBe(60); // 0.75 × 80, sole winner in top tier
    expect(earned["u2_r16"]).toBe(0);  // wrong team → excluded entirely
  });
});
