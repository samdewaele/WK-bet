import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    match: { findFirst: vi.fn(), findMany: vi.fn() },
  },
}));

import { db } from "@/lib/db";
import { isTournamentStarted, getGroupKickoffTimes } from "@/lib/tournament-lock";

const mockDb = db as any;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isTournamentStarted", () => {
  it("returns false when no matches exist", async () => {
    mockDb.match.findFirst.mockResolvedValue(null);
    expect(await isTournamentStarted()).toBe(false);
  });

  it("returns false when first match is in the future", async () => {
    mockDb.match.findFirst.mockResolvedValue({ kickoff: new Date(Date.now() + 86_400_000) });
    expect(await isTournamentStarted()).toBe(false);
  });

  it("returns true when first match is in the past", async () => {
    mockDb.match.findFirst.mockResolvedValue({ kickoff: new Date(Date.now() - 3_600_000) });
    expect(await isTournamentStarted()).toBe(true);
  });

  it("returns true when first match kickoff equals now (boundary)", async () => {
    const now = new Date();
    mockDb.match.findFirst.mockResolvedValue({ kickoff: now });
    expect(await isTournamentStarted()).toBe(true);
  });

  it("queries only Group round matches in asc kickoff order", async () => {
    mockDb.match.findFirst.mockResolvedValue(null);
    await isTournamentStarted();
    expect(mockDb.match.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { round: "Group" },
        orderBy: { kickoff: "asc" },
      }),
    );
  });
});

describe("getGroupKickoffTimes", () => {
  const t = (offsetMs: number) => new Date(Date.now() + offsetMs);

  it("returns empty object when there are no group matches", async () => {
    mockDb.match.findMany.mockResolvedValue([]);
    expect(await getGroupKickoffTimes()).toEqual({});
  });

  it("returns the first kickoff per group as an ISO string", async () => {
    const kickoffA = t(-3_600_000);
    const kickoffB = t(-1_800_000);
    mockDb.match.findMany.mockResolvedValue([
      { group: "A", kickoff: kickoffA },
      { group: "B", kickoff: kickoffB },
    ]);
    const result = await getGroupKickoffTimes();
    expect(result.A).toBe(kickoffA.toISOString());
    expect(result.B).toBe(kickoffB.toISOString());
  });

  it("uses only the earliest kickoff when a group has multiple matches", async () => {
    const first  = t(-7_200_000);
    const second = t(-3_600_000);
    const third  = t(-1_800_000);
    // Matches are returned in ascending kickoff order (per orderBy in the query)
    mockDb.match.findMany.mockResolvedValue([
      { group: "A", kickoff: first },
      { group: "A", kickoff: second },
      { group: "A", kickoff: third },
    ]);
    const result = await getGroupKickoffTimes();
    expect(result.A).toBe(first.toISOString());
    expect(Object.keys(result)).toHaveLength(1);
  });

  it("ignores matches with a null group", async () => {
    mockDb.match.findMany.mockResolvedValue([
      { group: null, kickoff: t(-3_600_000) },
      { group: "C",  kickoff: t(-1_800_000) },
    ]);
    const result = await getGroupKickoffTimes();
    expect(result.C).toBeDefined();
    expect(Object.keys(result)).toHaveLength(1);
  });

  it("queries Group round matches excluding null groups, ordered by kickoff asc", async () => {
    mockDb.match.findMany.mockResolvedValue([]);
    await getGroupKickoffTimes();
    expect(mockDb.match.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { round: "Group", group: { not: null } },
        orderBy: { kickoff: "asc" },
      }),
    );
  });
});
