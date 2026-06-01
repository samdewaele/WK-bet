import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    groupStandingPrediction: { findMany: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    kOPrediction: { findMany: vi.fn(), update: vi.fn().mockResolvedValue({}) },
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
// KO matches
// ---------------------------------------------------------------------------

function ko(id: string, home: number, away: number) {
  return { id, homeScore: home, awayScore: away };
}

describe("scoreRoomKOMatch — exact > correct-winner > wrong", () => {
  it("sole exact score takes the whole match prize", async () => {
    mockDb.kOPrediction.findMany.mockResolvedValue([
      ko("exact", 2, 0),
      ko("winner", 1, 0),
      ko("wrong", 0, 1),
    ]);

    await scoreRoomKOMatch("r1", "m1", "R32", 80, 2, 0);

    const earned = earnedById(mockDb.kOPrediction.update);
    expect(earned.exact).toBe(80);
    expect(earned.winner).toBe(0);
    expect(earned.wrong).toBe(0);
  });

  it("with no exact score, correct-winner tier splits the prize", async () => {
    mockDb.kOPrediction.findMany.mockResolvedValue([
      ko("w1", 1, 0),
      ko("w2", 3, 0),
      ko("wrong", 0, 2),
    ]);

    await scoreRoomKOMatch("r1", "m1", "R32", 80, 2, 0);

    const earned = earnedById(mockDb.kOPrediction.update);
    // 0.75 multiplier, two winners → (80 * 0.75) / 2 = 30 each
    expect(earned.w1).toBeCloseTo(30);
    expect(earned.w2).toBeCloseTo(30);
    expect(earned.wrong).toBe(0);
  });

  it("also writes accuracy points", async () => {
    mockDb.kOPrediction.findMany.mockResolvedValue([ko("exact", 2, 0)]);
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
