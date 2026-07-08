import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: { match: { findMany: vi.fn(), update: vi.fn().mockResolvedValue({}) } },
}));

import { db } from "@/lib/db";
import { repropagateKOBracket } from "@/lib/ko-seeding";

const mockDb = db as any;

type Row = {
  id: string;
  matchNumber: number;
  round: string;
  status: string;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeScore: number | null;
  awayScore: number | null;
  penaltyWinner: string | null;
};

function row(partial: Partial<Row> & { matchNumber: number; round: string }): Row {
  return {
    id: `m${partial.matchNumber}`,
    status: "scheduled",
    homeTeamId: null,
    awayTeamId: null,
    homeScore: null,
    awayScore: null,
    penaltyWinner: null,
    ...partial,
  };
}

/** A finished KO match with a decisive regulation score. */
function finished(matchNumber: number, round: string, home: string | null, away: string | null): Row {
  return row({ matchNumber, round, status: "finished", homeTeamId: home, awayTeamId: away, homeScore: 1, awayScore: 0 });
}

/** Collect update() calls → { matchId: data }. */
function updates(): Record<string, any> {
  const out: Record<string, any> = {};
  for (const c of mockDb.match.update.mock.calls) out[c[0].where.id] = c[0].data;
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.match.update.mockResolvedValue({});
});

describe("repropagateKOBracket", () => {
  it("seeds the QF slots from finished R16 results (regression: reset-then-read only reached R16)", async () => {
    // Two R16 matches feed QF 97 (= W89 v W90). Their R16 competitors come from
    // finished R32 results. R16 rows carry stale/blank team slots — repropagation
    // must recompute them from R32, then advance the R16 winners into the QF.
    const rows: Row[] = [
      // R32 → R16 89 (W74 v W77) and R16 90 (W73 v W75)
      finished(73, "R32", "A", "B"), // A → 90.home
      finished(74, "R32", "E", "F"), // E → 89.home
      finished(75, "R32", "C", "D"), // C → 90.away
      finished(77, "R32", "G", "H"), // G → 89.away
      // R16 finished — stored team slots intentionally blank to prove they're recomputed
      row({ matchNumber: 89, round: "R16", status: "finished", homeScore: 1, awayScore: 0 }), // E beats G → 97.home
      row({ matchNumber: 90, round: "R16", status: "finished", homeScore: 1, awayScore: 0 }), // A beats C → 97.away
      // QF placeholder, still TBD in the DB
      row({ matchNumber: 97, round: "QF" }),
    ];
    mockDb.match.findMany.mockResolvedValue(rows);

    await repropagateKOBracket();
    const u = updates();

    // R16 slots recomputed from the R32 winners
    expect(u.m89).toEqual({ homeTeamId: "E", awayTeamId: "G" });
    expect(u.m90).toEqual({ homeTeamId: "A", awayTeamId: "C" });
    // The bug: QF stayed TBD. Now it must carry the R16 winners.
    expect(u.m97).toEqual({ homeTeamId: "E", awayTeamId: "A" });
  });

  it("leaves an undecided round as TBD and heals a stale downstream slot back to null", async () => {
    const rows: Row[] = [
      finished(73, "R32", "A", "B"),
      finished(75, "R32", "C", "D"),
      // R16 90 not yet played → QF fed by it must be TBD
      row({ matchNumber: 90, round: "R16", homeTeamId: "A", awayTeamId: "C" }),
      // QF 97 wrongly holds a phantom team from an earlier bad binding
      row({ matchNumber: 97, round: "QF", homeTeamId: "Z", awayTeamId: null }),
    ];
    mockDb.match.findMany.mockResolvedValue(rows);

    await repropagateKOBracket();
    const u = updates();

    // Phantom QF team is cleared back to TBD.
    expect(u.m97).toEqual({ homeTeamId: null, awayTeamId: null });
  });

  it("never rewrites the R32 base and no-ops when everything is already correct", async () => {
    const rows: Row[] = [
      finished(73, "R32", "A", "B"),
      finished(75, "R32", "C", "D"),
      // R16 90 already correctly seeded and undecided; QF 97 correctly TBD
      row({ matchNumber: 90, round: "R16", homeTeamId: "A", awayTeamId: "C" }),
      row({ matchNumber: 97, round: "QF" }),
    ];
    mockDb.match.findMany.mockResolvedValue(rows);

    await repropagateKOBracket();

    // R32 rows (m73/m75) are never updated, and nothing else changed → no writes.
    expect(mockDb.match.update).not.toHaveBeenCalled();
  });
});
