import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    room: { findUnique: vi.fn() },
    groupStandingPrediction: { groupBy: vi.fn() },
    kOPrediction: { groupBy: vi.fn() },
    match: { findMany: vi.fn() },
  },
}));

import { db } from "@/lib/db";
import { computeUberPotResults } from "@/lib/uber-pot";

const mockDb = db as any;

// fee=10, members=4 → totalPot=40, groupStagePot=20, koPot=20, prizePerWCGroup≈1.667
function room(opts: {
  fee?: number;
  members?: { userId: string; excludedFromPot?: boolean }[];
  sideBets?: { id: string; status: string; winnerEntryId: string | null; entries: { id: string; userId: string; isWinner?: boolean }[] }[];
}) {
  return {
    entryFee: opts.fee ?? 10,
    members: (opts.members ?? [{ userId: "u1" }, { userId: "u2" }, { userId: "u3" }, { userId: "u4" }]).map(
      (m) => ({ userId: m.userId, excludedFromPot: m.excludedFromPot ?? false }),
    ),
    sideBets: opts.sideBets ?? [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: nothing scored yet → empty groupBy results
  mockDb.groupStandingPrediction.groupBy.mockResolvedValue([]);
  mockDb.kOPrediction.groupBy.mockResolvedValue([]);
  mockDb.match.findMany.mockResolvedValue([]);
});

describe("computeUberPotResults", () => {
  it("returns empty result when the room is missing", async () => {
    mockDb.room.findUnique.mockResolvedValue(null);
    const r = await computeUberPotResults("r1");
    expect(r.uberPot).toBe(0);
    expect(r.accumulatedUberPot).toBe(0);
    expect(r.settledCount).toBe(0);
    expect(r.byBet.size).toBe(0);
    expect(r.byUser.size).toBe(0);
  });

  it("splits the remaining uber pot equally across settled bets", async () => {
    mockDb.room.findUnique.mockResolvedValue(
      room({
        fee: 10,
        sideBets: [
          { id: "b1", status: "settled", winnerEntryId: "e1", entries: [{ id: "e1", userId: "u1" }] },
          { id: "b2", status: "settled", winnerEntryId: "e2", entries: [{ id: "e2", userId: "u2" }] },
        ],
      }),
    );
    // Nothing distributed → whole pot (40) is the uber pot.
    const r = await computeUberPotResults("r1");
    expect(r.uberPot).toBe(40);
    expect(r.settledCount).toBe(2);
    expect(r.prizePerSettledBet).toBe(20);
    expect(r.byBet.get("b1")).toMatchObject({
      winnerEntryIds: ["e1"], winnerUserIds: ["u1"], winnerEntryId: "e1", winnerUserId: "u1",
      betShare: 20, prizePerWinner: 20, prize: 20,
    });
    expect(r.byUser.get("u1")).toBe(20);
    expect(r.byUser.get("u2")).toBe(20);
  });

  it("splits a single bet's share equally across tied winners", async () => {
    mockDb.room.findUnique.mockResolvedValue(
      room({
        fee: 10, // totalPot 40 → single settled bet gets the whole 40
        sideBets: [
          {
            id: "b1", status: "settled", winnerEntryId: "e1",
            entries: [
              { id: "e1", userId: "u1", isWinner: true },
              { id: "e2", userId: "u2", isWinner: true },
              { id: "e3", userId: "u3", isWinner: false },
            ],
          },
        ],
      }),
    );
    const r = await computeUberPotResults("r1");
    const b1 = r.byBet.get("b1")!;
    expect(b1.winnerUserIds).toEqual(["u1", "u2"]);
    expect(b1.betShare).toBe(40);
    expect(b1.prizePerWinner).toBe(20); // 40 split two ways
    expect(r.byUser.get("u1")).toBe(20);
    expect(r.byUser.get("u2")).toBe(20);
    expect(r.byUser.has("u3")).toBe(false);
  });

  it("ignores open/proposed bets when dividing the pot", async () => {
    mockDb.room.findUnique.mockResolvedValue(
      room({
        fee: 10,
        sideBets: [
          { id: "b1", status: "settled", winnerEntryId: "e1", entries: [{ id: "e1", userId: "u1" }] },
          { id: "b2", status: "open", winnerEntryId: null, entries: [{ id: "e2", userId: "u2" }] },
        ],
      }),
    );
    const r = await computeUberPotResults("r1");
    expect(r.settledCount).toBe(1);
    expect(r.prizePerSettledBet).toBe(40); // whole pot to the single settled bet
    expect(r.byBet.has("b2")).toBe(false);
  });

  it("shrinks the uber pot by group + KO distributed amounts", async () => {
    // Simulate: Group A distributed 10 across members, KO match m1 (R32) distributed 6.
    mockDb.groupStandingPrediction.groupBy.mockResolvedValue([
      { wcGroup: "A", _sum: { earnedAmount: 10 } },
    ]);
    mockDb.kOPrediction.groupBy.mockResolvedValue([
      { matchId: "m1", _sum: { earnedAmount: 6 } },
    ]);
    mockDb.match.findMany.mockResolvedValue([{ id: "m1", round: "R32" }]);
    mockDb.room.findUnique.mockResolvedValue(
      room({
        fee: 10,
        sideBets: [
          { id: "b1", status: "settled", winnerEntryId: "e1", entries: [{ id: "e1", userId: "u1" }] },
        ],
      }),
    );
    const r = await computeUberPotResults("r1");
    expect(r.uberPot).toBe(40 - 10 - 6); // 24
    expect(r.prizePerSettledBet).toBe(24);
  });

  it("accumulates winnings per user across multiple settled bets", async () => {
    mockDb.room.findUnique.mockResolvedValue(
      room({
        fee: 10,
        sideBets: [
          { id: "b1", status: "settled", winnerEntryId: "e1", entries: [{ id: "e1", userId: "u1" }] },
          { id: "b2", status: "settled", winnerEntryId: "e2", entries: [{ id: "e2", userId: "u1" }] },
        ],
      }),
    );
    const r = await computeUberPotResults("r1");
    expect(r.byUser.get("u1")).toBe(40); // both bets won by u1, 20 each
  });

  it("accumulated uber pot grows from 0 as groups finish with unclaimed prizes", async () => {
    // prizePerWCGroup = totalPot*0.5/12 = 40*0.5/12 = 5/3 ≈ 1.667
    // Group A scored: 1 member earned 0.8 (partial prize) → unclaimed = 1.667 - 0.8
    // Group B scored: nobody won → unclaimed = full 1.667
    mockDb.groupStandingPrediction.groupBy.mockResolvedValue([
      { wcGroup: "A", _sum: { earnedAmount: 0.8 } },
      { wcGroup: "B", _sum: { earnedAmount: 0 } },
    ]);
    mockDb.room.findUnique.mockResolvedValue(room({}));
    const r = await computeUberPotResults("r1");
    const prizePerWCGroup = (40 * 0.5) / 12;
    const expected = Math.max(0, prizePerWCGroup - 0.8) + Math.max(0, prizePerWCGroup - 0);
    expect(r.accumulatedUberPot).toBeCloseTo(expected, 5);
    // accumulatedUberPot is less than uberPot (unscored groups still counted in uberPot)
    expect(r.accumulatedUberPot).toBeLessThan(r.uberPot);
  });
});
