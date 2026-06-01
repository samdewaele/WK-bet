import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: { match: { findMany: vi.fn(), update: vi.fn().mockResolvedValue({}) } },
}));

import { db } from "@/lib/db";
import { populateGroupQualifiers } from "@/lib/ko-seeding";

const mockDb = db as any;

// R32 matchNumbers are 73..88 in ascending order, aligned with R32_SLOTS.
const R32 = Array.from({ length: 16 }, (_, i) => ({ id: `m${73 + i}` }));

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.match.update.mockResolvedValue({});
  mockDb.match.findMany.mockResolvedValue(R32);
});

/** Collect update() calls → { matchId: data }. */
function updates(): Record<string, any> {
  const out: Record<string, any> = {};
  for (const c of mockDb.match.update.mock.calls) out[c[0].where.id] = c[0].data;
  return out;
}

describe("populateGroupQualifiers", () => {
  it("drops Group A winner into match 79 (home) and runner-up into match 73 (home)", async () => {
    await populateGroupQualifiers("A", "WIN_A", "RUN_A");
    const u = updates();
    // 73: runner-up A is the home slot; 79: winner A is the home slot
    expect(u["m73"]).toEqual({ homeTeamId: "RUN_A" });
    expect(u["m79"]).toEqual({ homeTeamId: "WIN_A" });
    // only A's slots are touched
    expect(Object.keys(u).sort()).toEqual(["m73", "m79"]);
  });

  it("drops Group B winner into match 85 (home) and runner-up into match 73 (away)", async () => {
    await populateGroupQualifiers("B", "WIN_B", "RUN_B");
    const u = updates();
    expect(u["m73"]).toEqual({ awayTeamId: "RUN_B" }); // runner-up B is away in match 73
    expect(u["m85"]).toEqual({ homeTeamId: "WIN_B" }); // winner B is home in match 85
  });

  it("is a no-op when the R32 bracket isn't seeded (wrong match count)", async () => {
    mockDb.match.findMany.mockResolvedValue([{ id: "m73" }]);
    await populateGroupQualifiers("A", "WIN_A", "RUN_A");
    expect(mockDb.match.update).not.toHaveBeenCalled();
  });
});
