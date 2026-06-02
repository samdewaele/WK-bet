import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    room: { findUnique: vi.fn() },
    groupStandingPrediction: { aggregate: vi.fn() },
    kOPrediction: { aggregate: vi.fn() },
  },
}));

import { db } from "@/lib/db";
import { computeUberPotResults } from "@/lib/uber-pot";

const mockDb = db as any;

// calculatePot: groupStagePot = 70% of (fee*members), uberPot baseline is the
// remainder after group + KO prizes are distributed. With fee=10, members=4 →
// totalPot = 40. We drive distributed amounts via the aggregates below.
function room(opts: {
  fee?: number;
  members?: { userId: string; excludedFromPot?: boolean }[];
  sideBets?: { id: string; status: string; winnerEntryId: string | null; entries: { id: string; userId: string }[] }[];
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
  mockDb.groupStandingPrediction.aggregate.mockResolvedValue({ _sum: { earnedAmount: 0 } });
  mockDb.kOPrediction.aggregate.mockResolvedValue({ _sum: { earnedAmount: 0 } });
});

describe("computeUberPotResults", () => {
  it("returns empty result when the room is missing", async () => {
    mockDb.room.findUnique.mockResolvedValue(null);
    const r = await computeUberPotResults("r1");
    expect(r.uberPot).toBe(0);
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
    // Nothing distributed in group/KO → whole pot (40) is the uber pot.
    const r = await computeUberPotResults("r1");
    expect(r.uberPot).toBe(40);
    expect(r.settledCount).toBe(2);
    expect(r.prizePerSettledBet).toBe(20);
    expect(r.byBet.get("b1")).toEqual({ winnerEntryId: "e1", winnerUserId: "u1", prize: 20 });
    expect(r.byUser.get("u1")).toBe(20);
    expect(r.byUser.get("u2")).toBe(20);
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
    mockDb.groupStandingPrediction.aggregate.mockResolvedValue({ _sum: { earnedAmount: 10 } });
    mockDb.kOPrediction.aggregate.mockResolvedValue({ _sum: { earnedAmount: 6 } });
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
});
