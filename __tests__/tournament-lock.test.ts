import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    match: { findFirst: vi.fn() },
  },
}));

import { db } from "@/lib/db";
import { isTournamentStarted } from "@/lib/tournament-lock";

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
