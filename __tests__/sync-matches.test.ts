import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks (must precede imports of the mocked modules) ──────────────────────

vi.mock("@/lib/football-data", () => ({
  fetchWCMatches: vi.fn(),
  mapStatus: vi.fn((s: string) => {
    if (["IN_PLAY", "PAUSED", "HALFTIME"].includes(s)) return "live";
    if (s === "FINISHED") return "finished";
    return "scheduled";
  }),
}));

vi.mock("@/lib/db", () => ({
  db: {
    match: { findMany: vi.fn(), update: vi.fn(), count: vi.fn(), findFirst: vi.fn() },
    prediction: { update: vi.fn() },
    room: { findMany: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("@/lib/notifications", () => ({
  checkAndSendRoundNotifications: vi.fn(),
  checkAndSendIncompleteReminders: vi.fn(),
}));

vi.mock("@/lib/ko-seeding", () => ({
  computeGroupStandings: vi.fn(),
  populateR32Bracket: vi.fn(),
  populateNextRoundSlot: vi.fn(),
}));

vi.mock("@/lib/scoring", () => ({
  scoreAndAdvanceCompletedGroups: vi.fn(),
  scoreKOMatchForAllRooms: vi.fn(),
}));

vi.mock("@/lib/points", () => ({ calculatePoints: vi.fn() }));

// ─── Imports ─────────────────────────────────────────────────────────────────

import { db } from "@/lib/db";
import { fetchWCMatches } from "@/lib/football-data";
import { calculatePoints } from "@/lib/points";
import { checkAndSendRoundNotifications, checkAndSendIncompleteReminders } from "@/lib/notifications";
import { computeGroupStandings, populateR32Bracket, populateNextRoundSlot } from "@/lib/ko-seeding";
import { scoreAndAdvanceCompletedGroups, scoreKOMatchForAllRooms } from "@/lib/scoring";
import { syncMatches } from "@/lib/sync-matches";

// ─── Typed mock references ────────────────────────────────────────────────────

const mockDb = db as any;
const mockFetch = vi.mocked(fetchWCMatches);
const mockCalcPoints = vi.mocked(calculatePoints);
const mockNotifications = vi.mocked(checkAndSendRoundNotifications);
const mockReminders = vi.mocked(checkAndSendIncompleteReminders);
const mockPopulateNextRound = vi.mocked(populateNextRoundSlot);
const mockComputeStandings = vi.mocked(computeGroupStandings);
const mockPopulateR32 = vi.mocked(populateR32Bracket);
const mockScoreGroups = vi.mocked(scoreAndAdvanceCompletedGroups);
const mockScoreKO = vi.mocked(scoreKOMatchForAllRooms);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal FDMatch for GROUP_STAGE. Overrides are shallow-merged. */
function apiGroupMatch(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? 1,
    utcDate: overrides.utcDate ?? "2026-06-12T15:00:00Z",
    status: overrides.status ?? "FINISHED",
    stage: overrides.stage ?? "GROUP_STAGE",
    homeTeam: overrides.homeTeam ?? { id: 10, name: "Brazil", shortName: "Brazil", tla: "BRA" },
    awayTeam: overrides.awayTeam ?? { id: 11, name: "Germany", shortName: "Germany", tla: "GER" },
    score: overrides.score ?? { winner: "HOME_TEAM", fullTime: { home: 2, away: 1 } },
    ...overrides,
  };
}

/**
 * Build an array of GROUP_STAGE FDMatches.
 * @param total        Total number of matches to generate.
 * @param finishedCount  How many should have status "FINISHED" (rest are "SCHEDULED").
 */
function makeGroupMatches(total: number, finishedCount: number) {
  return Array.from({ length: total }, (_, i) => ({
    id: 100 + i,
    utcDate: "2026-06-12T15:00:00Z",
    status: i < finishedCount ? "FINISHED" : "SCHEDULED",
    stage: "GROUP_STAGE",
    homeTeam: { id: 200 + i * 2, name: `HomeTeam${i}`, shortName: `Home${i}`, tla: `H${i}` },
    awayTeam: { id: 201 + i * 2, name: `AwayTeam${i}`, shortName: `Away${i}`, tla: `A${i}` },
    score: { winner: i < finishedCount ? "HOME_TEAM" : null, fullTime: { home: i < finishedCount ? 1 : null, away: i < finishedCount ? 0 : null } },
  }));
}

/**
 * Build a minimal DB match object.
 * Defaults: status="scheduled", no predictions, round="Group", homeTeam present.
 */
function dbMatch(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? "db-match-1",
    kickoff: overrides.kickoff ?? new Date("2026-06-12T15:00:00Z"),
    status: overrides.status ?? "scheduled",
    homeScore: overrides.homeScore ?? null,
    awayScore: overrides.awayScore ?? null,
    round: overrides.round ?? "Group",
    matchNumber: overrides.matchNumber ?? null,
    homeTeam: overrides.homeTeam !== undefined
      ? overrides.homeTeam
      : { id: "ht-1", fdId: null, name: "Brazil", shortName: "Brazil", tla: "BRA" },
    awayTeam: overrides.awayTeam !== undefined
      ? overrides.awayTeam
      : { id: "at-1", fdId: null, name: "Germany", shortName: "Germany", tla: "GER" },
    predictions: overrides.predictions ?? [],
    ...overrides,
  };
}

interface SetupOptions {
  /** What db.match.findMany returns (for match update loop). Default: [] */
  dbMatches?: any[];
  /** What db.match.findFirst returns for the { round: "Group" } query. Default: null */
  firstGroupKickoff?: { kickoff: Date } | null;
  /** What db.match.findFirst returns for the KO rounds query. Default: null */
  firstKOKickoff?: { kickoff: Date } | null;
  /** What db.match.count returns for the R32 populated query. Default: 0 */
  r32PopulatedCount?: number;
  /** What db.room.findMany returns. Default: [] */
  rooms?: any[];
  /** What checkAndSendRoundNotifications resolves with. Default: [] */
  notificationsSent?: any[];
  /** What checkAndSendIncompleteReminders resolves with. Default: [] */
  remindersSent?: any[];
}

/**
 * Configure all standard mocks with sensible defaults.
 * Call this in beforeEach or at the start of any test that needs non-trivial state.
 */
function setupMocks(opts: SetupOptions = {}) {
  const {
    dbMatches = [],
    firstGroupKickoff = null,
    firstKOKickoff = null,
    r32PopulatedCount = 0,
    rooms = [],
    notificationsSent = [],
    remindersSent = [],
  } = opts;

  // Differentiate the two findMany calls:
  // 1. Stale reset pass uses { where: { OR: [...] } } — return only non-clean matches
  // 2. Main update loop has no `where` — return the full list
  mockDb.match.findMany.mockImplementation((args: any) => {
    if (args?.where?.OR) {
      return Promise.resolve(
        dbMatches.filter((m: any) =>
          m.status !== "scheduled" || m.homeScore !== null || m.awayScore !== null
        )
      );
    }
    return Promise.resolve(dbMatches);
  });
  mockDb.match.update.mockResolvedValue({});
  mockDb.prediction.update.mockResolvedValue({});
  mockDb.room.update.mockResolvedValue({});

  // findFirst: distinguish by the where clause
  mockDb.match.findFirst.mockImplementation((args: any) => {
    const where = args?.where ?? {};
    if (where.round === "Group") return Promise.resolve(firstGroupKickoff);
    // KO rounds query uses { round: { in: [...] } }
    if (where.round?.in) return Promise.resolve(firstKOKickoff);
    return Promise.resolve(null);
  });

  // count: only the R32 populated check remains (tournamentOver now uses API data)
  mockDb.match.count.mockImplementation((args: any) => {
    const where = args?.where ?? {};
    if (where.round === "R32") return Promise.resolve(r32PopulatedCount);
    return Promise.resolve(0);
  });

  mockDb.room.findMany.mockResolvedValue(rooms);

  mockNotifications.mockResolvedValue(notificationsSent as any);
  mockReminders.mockResolvedValue(remindersSent as any);

  mockCalcPoints.mockReturnValue(3);
  mockScoreGroups.mockResolvedValue(undefined as any);
  mockScoreKO.mockResolvedValue(undefined as any);
  mockPopulateNextRound.mockResolvedValue(undefined as any);
  mockComputeStandings.mockResolvedValue([] as any);
  mockPopulateR32.mockResolvedValue(undefined as any);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("1. Early return when no actionable matches", () => {
  beforeEach(() => setupMocks());

  it("returns early with updated:0 when all API matches are SCHEDULED/TIMED", async () => {
    mockFetch.mockResolvedValue([
      apiGroupMatch({ status: "SCHEDULED" }),
      apiGroupMatch({ id: 2, status: "TIMED" }),
    ] as any);

    const result = await syncMatches();

    expect(result.updated).toBe(0);
    expect(result.predictionsScored).toBe(0);
    expect(result.message).toBe("No live or finished matches yet");
    expect(result.notificationsSent).toEqual([]);
    expect(result.remindersSent).toEqual([]);
  });

  it("returns early with updated:0 when API response is empty", async () => {
    mockFetch.mockResolvedValue([]);

    const result = await syncMatches();

    expect(result.updated).toBe(0);
    expect(result.message).toBe("No live or finished matches yet");
  });

  it("does not call the main-loop db.match.findMany when returning early (stale reset still runs)", async () => {
    mockFetch.mockResolvedValue([apiGroupMatch({ status: "SCHEDULED" })] as any);

    await syncMatches();

    // Stale reset calls findMany({ where: { OR: [...] } }) — that IS expected.
    // The main update loop calls findMany with no `where` — that should NOT happen.
    const mainLoopCalls = mockDb.match.findMany.mock.calls.filter(
      (c: any) => !c[0]?.where?.OR
    );
    expect(mainLoopCalls).toHaveLength(0);
  });

  it("still calls auto-transition queries even when returning early (time-based triggers must fire)", async () => {
    mockFetch.mockResolvedValue([]);

    await syncMatches();

    // Auto-transition block runs unconditionally so ko_betting → ko_active fires
    // during the gap between group stage completion and first KO kickoff.
    expect(mockDb.match.findFirst).toHaveBeenCalled();
    expect(mockDb.room.findMany).toHaveBeenCalled();
  });

  it("still calls notification functions even when returning early", async () => {
    mockFetch.mockResolvedValue([]);

    await syncMatches();

    expect(mockNotifications).toHaveBeenCalled();
    expect(mockReminders).toHaveBeenCalled();
  });
});

describe("2. Match update logic", () => {
  const kickoff = new Date("2026-06-12T15:00:00Z");

  beforeEach(() => {
    setupMocks({ rooms: [] });
    mockFetch.mockResolvedValue([
      apiGroupMatch({ utcDate: kickoff.toISOString(), status: "FINISHED", score: { winner: "HOME_TEAM", fullTime: { home: 2, away: 1 } } }),
    ] as any);
  });

  it("calls db.match.update with correct id, status 'finished', and scores for a FINISHED match", async () => {
    mockDb.match.findMany.mockResolvedValue([
      dbMatch({ kickoff, status: "scheduled" }),
    ]);

    await syncMatches();

    // kickoff is also synced from the API so the per-group lock uses the real time
    expect(mockDb.match.update).toHaveBeenCalledWith({
      where: { id: "db-match-1" },
      data: expect.objectContaining({ status: "finished", homeScore: 2, awayScore: 1 }),
    });
  });

  it("skips a match when status and scores are identical to DB (unchanged)", async () => {
    mockDb.match.findMany.mockResolvedValue([
      dbMatch({ kickoff, status: "finished", homeScore: 2, awayScore: 1 }),
    ]);

    await syncMatches();

    expect(mockDb.match.update).not.toHaveBeenCalled();
  });

  it("skips a match when no DB match has the same home+away team pair", async () => {
    mockDb.match.findMany.mockResolvedValue([
      // API has Brazil vs Germany; DB only has France vs Germany — home team differs
      dbMatch({ kickoff, status: "scheduled", homeTeam: { id: "ht-x", name: "France", shortName: "France", tla: "FRA" } }),
    ]);

    await syncMatches();

    expect(mockDb.match.update).not.toHaveBeenCalled();
  });

  it("matches a DB match by team names regardless of kickoff proximity", async () => {
    // DB kickoff is 2 hours after the API kickoff — old seed data vs real schedule
    const seedKickoff = new Date(kickoff.getTime() + 2 * 60 * 60 * 1000);
    mockDb.match.findMany.mockResolvedValue([
      dbMatch({ kickoff: seedKickoff, status: "scheduled" }),
    ]);

    await syncMatches();

    expect(mockDb.match.update).toHaveBeenCalled();
  });

  it("matches by team name case-insensitively within 10 min kickoff window", async () => {
    mockFetch.mockResolvedValue([
      apiGroupMatch({
        utcDate: kickoff.toISOString(),
        status: "FINISHED",
        homeTeam: { id: 10, name: "BRAZIL", shortName: "Brazil", tla: "BRA" },
        score: { winner: "HOME_TEAM", fullTime: { home: 2, away: 1 } },
      }),
    ] as any);
    mockDb.match.findMany.mockResolvedValue([
      dbMatch({ kickoff, status: "scheduled", homeTeam: { id: "ht-1", name: "brazil", shortName: "brazil", tla: "BRA" } }),
    ]);

    await syncMatches();

    expect(mockDb.match.update).toHaveBeenCalled();
  });

  it("matches a KO slot with no homeTeam (TBD) on kickoff alone", async () => {
    mockDb.match.findMany.mockResolvedValue([
      dbMatch({ kickoff, status: "scheduled", homeTeam: null, awayTeam: null, round: "R32" }),
    ]);

    await syncMatches();

    expect(mockDb.match.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "db-match-1" } })
    );
  });

  it("does not include null scores in update data when API scores are null", async () => {
    mockFetch.mockResolvedValue([
      apiGroupMatch({ utcDate: kickoff.toISOString(), status: "IN_PLAY", score: { winner: null, fullTime: { home: null, away: null } } }),
    ] as any);
    mockDb.match.findMany.mockResolvedValue([
      dbMatch({ kickoff, status: "scheduled" }),
    ]);

    await syncMatches();

    const updateCall = mockDb.match.update.mock.calls[0][0];
    expect(updateCall.data).not.toHaveProperty("homeScore");
    expect(updateCall.data).not.toHaveProperty("awayScore");
    expect(updateCall.data.status).toBe("live");
  });
});

describe("3. Prediction scoring when match finishes", () => {
  const kickoff = new Date("2026-06-12T15:00:00Z");
  const predictions = [
    { id: "pred-1", homeScore: 1, awayScore: 0 },
    { id: "pred-2", homeScore: 2, awayScore: 1 },
  ];

  beforeEach(() => {
    setupMocks({ rooms: [] });
    mockFetch.mockResolvedValue([
      apiGroupMatch({ utcDate: kickoff.toISOString(), status: "FINISHED", score: { winner: "HOME_TEAM", fullTime: { home: 2, away: 1 } } }),
    ] as any);
  });

  it("calls calculatePoints for each prediction when match transitions to finished", async () => {
    mockDb.match.findMany.mockResolvedValue([
      dbMatch({ kickoff, status: "scheduled", predictions, round: "Group" }),
    ]);

    await syncMatches();

    expect(mockCalcPoints).toHaveBeenCalledTimes(2);
    expect(mockCalcPoints).toHaveBeenCalledWith("Group", 1, 0, 2, 1);
    expect(mockCalcPoints).toHaveBeenCalledWith("Group", 2, 1, 2, 1);
  });

  it("calls db.prediction.update for each prediction with the calculated points", async () => {
    mockCalcPoints.mockReturnValue(5);
    mockDb.match.findMany.mockResolvedValue([
      dbMatch({ kickoff, status: "scheduled", predictions, round: "Group" }),
    ]);

    await syncMatches();

    expect(mockDb.prediction.update).toHaveBeenCalledTimes(2);
    expect(mockDb.prediction.update).toHaveBeenCalledWith({ where: { id: "pred-1" }, data: { points: 5 } });
    expect(mockDb.prediction.update).toHaveBeenCalledWith({ where: { id: "pred-2" }, data: { points: 5 } });
  });

  it("reflects prediction count in predictionsScored", async () => {
    mockDb.match.findMany.mockResolvedValue([
      dbMatch({ kickoff, status: "scheduled", predictions, round: "Group" }),
    ]);

    const result = await syncMatches();

    expect(result.predictionsScored).toBe(2);
  });

  it("rescores predictions when match was already 'finished' but scores changed (sim data correction)", async () => {
    // DB has wrong sim score (1-0); real API result is 2-1.
    // wasFinished=true but scoresChanged=true → must rescore.
    mockDb.match.findMany.mockImplementation((args: any) => {
      if (args?.where?.OR) return Promise.resolve([]); // stale reset: nothing stale
      return Promise.resolve([
        dbMatch({ kickoff, status: "finished", homeScore: 1, awayScore: 0, predictions, round: "Group" }),
      ]);
    });

    await syncMatches();

    expect(mockCalcPoints).toHaveBeenCalledTimes(2);
    expect(mockDb.prediction.update).toHaveBeenCalledTimes(2);
  });

  it("does NOT re-score predictions when DB match was already 'finished' with the same scores (unchanged)", async () => {
    // Exact same state in DB and API → unchanged check fires, no update at all.
    mockDb.match.findMany.mockImplementation((args: any) => {
      if (args?.where?.OR) return Promise.resolve([]);
      return Promise.resolve([
        dbMatch({ kickoff, status: "finished", homeScore: 2, awayScore: 1, predictions, round: "Group" }),
      ]);
    });

    await syncMatches();

    expect(mockCalcPoints).not.toHaveBeenCalled();
    expect(mockDb.prediction.update).not.toHaveBeenCalled();
  });

  it("predictionsScored is 0 when no prediction scoring happens", async () => {
    mockDb.match.findMany.mockResolvedValue([
      dbMatch({ kickoff, status: "finished", homeScore: 2, awayScore: 0, predictions, round: "Group" }),
    ]);
    // API says same final score but the overall record is unchanged — so no update, no scoring
    mockFetch.mockResolvedValue([
      apiGroupMatch({ utcDate: kickoff.toISOString(), status: "FINISHED", score: { winner: "HOME_TEAM", fullTime: { home: 2, away: 0 } } }),
    ] as any);

    const result = await syncMatches();

    expect(result.predictionsScored).toBe(0);
  });
});

describe("4. KO bracket progression", () => {
  const kickoff = new Date("2026-06-12T15:00:00Z");

  beforeEach(() => {
    setupMocks({ rooms: [] });
    mockFetch.mockResolvedValue([
      apiGroupMatch({ utcDate: kickoff.toISOString(), status: "FINISHED", score: { winner: "HOME_TEAM", fullTime: { home: 2, away: 1 } } }),
    ] as any);
  });

  it("calls populateNextRoundSlot(matchNumber, homeTeamId, awayTeamId) when home team wins R32", async () => {
    mockDb.match.findMany.mockResolvedValue([
      dbMatch({
        kickoff, status: "scheduled", round: "R32", matchNumber: 73,
        homeTeam: { id: "ht-1", name: "Brazil", shortName: "Brazil", tla: "BRA" },
        awayTeam: { id: "at-1", name: "Germany", shortName: "Germany", tla: "GER" },
        predictions: [],
      }),
    ]);

    await syncMatches();

    // Home wins 2-1: winner=ht-1, loser=at-1
    expect(mockPopulateNextRound).toHaveBeenCalledWith(73, "ht-1", "at-1");
  });

  it("calls populateNextRoundSlot(matchNumber, awayTeamId, homeTeamId) when away team wins R32", async () => {
    mockFetch.mockResolvedValue([
      apiGroupMatch({ utcDate: kickoff.toISOString(), status: "FINISHED", score: { winner: "AWAY_TEAM", fullTime: { home: 1, away: 2 } } }),
    ] as any);
    mockDb.match.findMany.mockResolvedValue([
      dbMatch({
        kickoff, status: "scheduled", round: "R32", matchNumber: 73,
        homeTeam: { id: "ht-1", name: "Brazil", shortName: "Brazil", tla: "BRA" },
        awayTeam: { id: "at-1", name: "Germany", shortName: "Germany", tla: "GER" },
        predictions: [],
      }),
    ]);

    await syncMatches();

    // Away wins 1-2: winner=at-1, loser=ht-1
    expect(mockPopulateNextRound).toHaveBeenCalledWith(73, "at-1", "ht-1");
  });

  it("does NOT call populateNextRoundSlot for Group round matches", async () => {
    mockDb.match.findMany.mockResolvedValue([
      dbMatch({ kickoff, status: "scheduled", round: "Group", matchNumber: 1, predictions: [] }),
    ]);

    await syncMatches();

    expect(mockPopulateNextRound).not.toHaveBeenCalled();
  });

  it("calls scoreKOMatchForAllRooms when a KO match finishes", async () => {
    mockDb.match.findMany.mockResolvedValue([
      dbMatch({
        kickoff, status: "scheduled", round: "R32", matchNumber: 73,
        homeTeam: { id: "ht-1", name: "Brazil", shortName: "Brazil", tla: "BRA" },
        awayTeam: { id: "at-1", name: "Germany", shortName: "Germany", tla: "GER" },
        predictions: [],
      }),
    ]);

    await syncMatches();

    expect(mockScoreKO).toHaveBeenCalledWith("db-match-1", "R32", 2, 1);
  });

  it("does NOT call scoreKOMatchForAllRooms for Group round matches", async () => {
    mockDb.match.findMany.mockResolvedValue([
      dbMatch({ kickoff, status: "scheduled", round: "Group", matchNumber: null, predictions: [] }),
    ]);

    await syncMatches();

    expect(mockScoreKO).not.toHaveBeenCalled();
  });
});

describe("5. Auto-transition: betting/closed → group_active", () => {
  const pastKickoff = new Date(Date.now() - 60 * 60 * 1000); // 1h ago
  const futureKickoff = new Date(Date.now() + 60 * 60 * 1000); // 1h from now

  beforeEach(() => {
    mockFetch.mockResolvedValue([
      apiGroupMatch({ status: "FINISHED" }),
    ] as any);
  });

  it("transitions a 'betting' room to group_active when first group kickoff is in the past", async () => {
    setupMocks({
      firstGroupKickoff: { kickoff: pastKickoff },
      rooms: [{ id: "r1", status: "betting" }],
    });

    await syncMatches();

    expect(mockDb.room.update).toHaveBeenCalledWith({ where: { id: "r1" }, data: { status: "group_active" } });
  });

  it("transitions a 'closed' room to group_active when first group kickoff is in the past", async () => {
    setupMocks({
      firstGroupKickoff: { kickoff: pastKickoff },
      rooms: [{ id: "r2", status: "closed" }],
    });

    await syncMatches();

    expect(mockDb.room.update).toHaveBeenCalledWith({ where: { id: "r2" }, data: { status: "group_active" } });
  });

  it("does NOT transition when first group kickoff is in the future", async () => {
    setupMocks({
      firstGroupKickoff: { kickoff: futureKickoff },
      rooms: [{ id: "r3", status: "betting" }],
    });

    await syncMatches();

    expect(mockDb.room.update).not.toHaveBeenCalled();
  });

  it("does NOT transition a room already in group_active to group_active", async () => {
    setupMocks({
      firstGroupKickoff: { kickoff: pastKickoff },
      rooms: [{ id: "r4", status: "group_active" }],
    });

    await syncMatches();

    // group_active rooms may transition to ko_betting if allGroupDone;
    // but with no GROUP_STAGE matches from API being all FINISHED (only 1 of 72),
    // no transition should happen either way.
    const groupActiveCalls = mockDb.room.update.mock.calls.filter(
      (c: any) => c[0].data.status === "group_active"
    );
    expect(groupActiveCalls).toHaveLength(0);
  });
});

describe("6. Auto-transition: group_active → ko_betting (KEY SECTION)", () => {
  beforeEach(() => {
    setupMocks({ firstGroupKickoff: null });
  });

  it("does NOT transition when 71 FINISHED + 1 SCHEDULED (total=72, not all done)", async () => {
    const matches72 = makeGroupMatches(72, 71); // 72 total, 71 finished
    mockFetch.mockResolvedValue(matches72 as any);
    setupMocks({
      rooms: [{ id: "r1", status: "group_active" }],
    });

    await syncMatches();

    expect(mockDb.room.update).not.toHaveBeenCalled();
  });

  it("does NOT transition when only 71 GROUP_STAGE matches in API, all FINISHED (< 72 total)", async () => {
    const matches71 = makeGroupMatches(71, 71); // 71 total, all finished
    mockFetch.mockResolvedValue(matches71 as any);
    setupMocks({
      rooms: [{ id: "r1", status: "group_active" }],
    });

    await syncMatches();

    expect(mockDb.room.update).not.toHaveBeenCalled();
  });

  it("does NOT transition when 72 GROUP_STAGE but only 1 is FINISHED (71 SCHEDULED)", async () => {
    const matches72 = makeGroupMatches(72, 1); // 72 total, only 1 finished
    mockFetch.mockResolvedValue(matches72 as any);
    setupMocks({
      rooms: [{ id: "r1", status: "group_active" }],
    });

    await syncMatches();

    expect(mockDb.room.update).not.toHaveBeenCalled();
  });

  it("transitions group_active → ko_betting when all 72 GROUP_STAGE are FINISHED", async () => {
    const matches72 = makeGroupMatches(72, 72); // 72 total, all finished
    // Need at least one actionable match so we don't early-return
    mockFetch.mockResolvedValue(matches72 as any);
    setupMocks({
      rooms: [{ id: "r1", status: "group_active" }],
    });

    await syncMatches();

    expect(mockDb.room.update).toHaveBeenCalledWith({ where: { id: "r1" }, data: { status: "ko_betting" } });
  });

  it("calls db.room.update with { status: 'ko_betting' } when all 72 are done", async () => {
    const matches72 = makeGroupMatches(72, 72);
    mockFetch.mockResolvedValue(matches72 as any);
    setupMocks({
      rooms: [{ id: "r1", status: "group_active" }],
    });

    await syncMatches();

    const call = mockDb.room.update.mock.calls[0][0];
    expect(call.data.status).toBe("ko_betting");
  });

  it("transitions a betting room straight to ko_betting when all GROUP_STAGE done (skips intermediate stages)", async () => {
    const matches72 = makeGroupMatches(72, 72);
    mockFetch.mockResolvedValue(matches72 as any);
    setupMocks({
      firstGroupKickoff: null,
      rooms: [{ id: "r1", status: "betting" }],
    });

    await syncMatches();

    // Derived status is ko_betting because allGroupDone=true.
    // No reason to pass through group_active — real tournament state wins.
    expect(mockDb.room.update).toHaveBeenCalledWith({ where: { id: "r1" }, data: { status: "ko_betting" } });
  });
});

describe("7. Auto-transition: ko_betting → ko_active", () => {
  beforeEach(() => {
    mockFetch.mockResolvedValue([apiGroupMatch({ status: "FINISHED" })] as any);
  });

  it("transitions ko_betting → ko_active when a KO kickoff is in the past", async () => {
    const pastKickoff = new Date(Date.now() - 30 * 60 * 1000);
    setupMocks({
      firstKOKickoff: { kickoff: pastKickoff },
      rooms: [{ id: "r1", status: "ko_betting" }],
    });

    await syncMatches();

    expect(mockDb.room.update).toHaveBeenCalledWith({ where: { id: "r1" }, data: { status: "ko_active" } });
  });

  it("does NOT transition when there is no KO kickoff yet (findFirst returns null)", async () => {
    setupMocks({
      firstKOKickoff: null,
      rooms: [{ id: "r1", status: "ko_betting" }],
    });

    await syncMatches();

    expect(mockDb.room.update).not.toHaveBeenCalled();
  });

  it("transitions ko_betting → ko_active even when actionable is empty (the production bug: gap between group stage and KO kickoff)", async () => {
    // Simulate the real-world state: all group matches are done, the API returns
    // only SCHEDULED/TIMED matches (no live or finished), but the first R32 kickoff
    // has already passed. Previously this was broken because the actionable early
    // return fired before auto-transitions. The API has data (hasReliableApiData=true)
    // but nothing is actionable.
    const pastKOKickoff = new Date(Date.now() - 30 * 60 * 1000); // 30min ago
    mockFetch.mockResolvedValue([
      apiGroupMatch({ status: "SCHEDULED" }), // API returns data but nothing actionable
    ] as any);
    setupMocks({
      firstKOKickoff: { kickoff: pastKOKickoff },
      rooms: [{ id: "r1", status: "ko_betting" }],
    });

    await syncMatches();

    expect(mockDb.room.update).toHaveBeenCalledWith({ where: { id: "r1" }, data: { status: "ko_active" } });
  });

  it("transitions ko_betting → ko_active when API returns only SCHEDULED matches (all group done, KO not started live yet)", async () => {
    const pastKOKickoff = new Date(Date.now() - 5 * 60 * 1000); // 5min ago
    mockFetch.mockResolvedValue([
      apiGroupMatch({ status: "SCHEDULED" }),
      apiGroupMatch({ id: 2, status: "TIMED" }),
    ] as any);
    setupMocks({
      firstKOKickoff: { kickoff: pastKOKickoff },
      rooms: [{ id: "r1", status: "ko_betting" }],
    });

    await syncMatches();

    expect(mockDb.room.update).toHaveBeenCalledWith({ where: { id: "r1" }, data: { status: "ko_active" } });
  });
});

describe("8. Auto-transition: ko_active → settling (API-based)", () => {
  it("transitions ko_active → settling when API reports the Final as FINISHED", async () => {
    // tournamentOver is derived exclusively from the API response — no DB query.
    mockFetch.mockResolvedValue([
      apiGroupMatch({ stage: "FINAL", status: "FINISHED" }),
    ] as any);
    setupMocks({
      rooms: [{ id: "r1", status: "ko_active" }],
    });

    await syncMatches();

    expect(mockDb.room.update).toHaveBeenCalledWith({ where: { id: "r1" }, data: { status: "settling" } });
  });

  it("does NOT transition when API has no FINAL stage matches at all", async () => {
    const pastKOKickoff = new Date(Date.now() - 30 * 60 * 1000);
    mockFetch.mockResolvedValue([apiGroupMatch({ status: "FINISHED" })] as any);
    setupMocks({
      firstKOKickoff: { kickoff: pastKOKickoff },
      rooms: [{ id: "r1", status: "ko_active" }],
    });

    await syncMatches();

    // koStarted=true, tournamentOver=false → correctStatus=ko_active → no update (already correct)
    expect(mockDb.room.update).not.toHaveBeenCalled();
  });

  it("does NOT transition when FINAL match is in API but not yet FINISHED (e.g. IN_PLAY)", async () => {
    const pastKOKickoff = new Date(Date.now() - 30 * 60 * 1000);
    mockFetch.mockResolvedValue([
      apiGroupMatch({ stage: "FINAL", status: "IN_PLAY" }),
    ] as any);
    setupMocks({
      firstKOKickoff: { kickoff: pastKOKickoff },
      rooms: [{ id: "r1", status: "ko_active" }],
    });

    await syncMatches();

    expect(mockDb.room.update).not.toHaveBeenCalled();
  });

  it("uses API data only — old DB-based Final count cannot trigger settling", async () => {
    // This test documents the production bug that was fixed: the DB had simulation
    // data with Final status=finished, causing every sync to push rooms to settling.
    // The fix reads only the API response; no db.match.count for Final is performed.
    const pastKOKickoff = new Date(Date.now() - 30 * 60 * 1000);
    mockFetch.mockResolvedValue([apiGroupMatch({ status: "FINISHED" })] as any); // GROUP_STAGE, not FINAL
    setupMocks({
      firstKOKickoff: { kickoff: pastKOKickoff },
      rooms: [{ id: "r1", status: "ko_active" }],
    });

    await syncMatches();

    // Even if the DB count mock returned 1 for Final, it is never consulted.
    // API has no FINAL match → tournamentOver=false → room stays ko_active.
    expect(mockDb.room.update).not.toHaveBeenCalled();
    // Confirm that db.match.count was NOT called with round: "Final"
    const countCallsWithFinal = mockDb.match.count.mock.calls.filter(
      (c: any) => c[0]?.where?.round === "Final"
    );
    expect(countCallsWithFinal).toHaveLength(0);
  });
});

describe("9. Simulation mode exclusion", () => {
  beforeEach(() => {
    mockFetch.mockResolvedValue([apiGroupMatch({ status: "FINISHED" })] as any);
  });

  it("db.room.findMany is called with { where: { simulationMode: false } }", async () => {
    setupMocks({ rooms: [] });

    await syncMatches();

    expect(mockDb.room.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ simulationMode: false }) })
    );
  });

  it("simulation rooms are never updated because they are excluded by the query", async () => {
    const matches72 = makeGroupMatches(72, 72);
    mockFetch.mockResolvedValue(matches72 as any);
    // The real query filters simulationMode: false — simulate this by returning no rooms
    setupMocks({
      rooms: [], // sim room not returned by the DB query
    });

    await syncMatches();

    expect(mockDb.room.update).not.toHaveBeenCalled();
  });

  it("only returns non-sim rooms from db.room.findMany (simulationMode: false filter)", async () => {
    const pastKickoff = new Date(Date.now() - 60 * 60 * 1000);
    setupMocks({
      firstGroupKickoff: { kickoff: pastKickoff },
      // Simulate: the DB query with simulationMode:false returns only real rooms
      rooms: [{ id: "real-room", status: "betting" }],
    });

    await syncMatches();

    // Only the real room transitions; sim room (not in result) does not
    expect(mockDb.room.update).toHaveBeenCalledTimes(1);
    expect(mockDb.room.update).toHaveBeenCalledWith({ where: { id: "real-room" }, data: { status: "group_active" } });
  });
});

describe("10. R32 bracket seeding (only when updated > 0)", () => {
  const kickoff = new Date("2026-06-12T15:00:00Z");

  it("calls computeGroupStandings and populateR32Bracket when updated>0, all 72 GROUP_STAGE done, r32 < 16", async () => {
    const matches72 = makeGroupMatches(72, 72);
    mockFetch.mockResolvedValue(matches72 as any);
    setupMocks({
      r32PopulatedCount: 0,
      rooms: [],
      dbMatches: [dbMatch({ kickoff, status: "scheduled", predictions: [] })],
    });
    // The first GROUP_STAGE match has the same home team name — make a custom match to trigger update
    mockFetch.mockResolvedValue([
      // One match that is actionable and will match the DB entry
      {
        id: 100,
        utcDate: kickoff.toISOString(),
        status: "FINISHED",
        stage: "GROUP_STAGE",
        homeTeam: { id: 200, name: "Brazil", shortName: "Brazil", tla: "BRA" },
        awayTeam: { id: 201, name: "Germany", shortName: "Germany", tla: "GER" },
        score: { winner: "HOME_TEAM", fullTime: { home: 2, away: 1 } },
      },
      // 71 more finished GROUP_STAGE matches (different teams/kickoffs for total ≥ 72)
      ...makeGroupMatches(71, 71).map((m, i) => ({ ...m, id: 500 + i })),
    ] as any);

    await syncMatches();

    expect(mockComputeStandings).toHaveBeenCalled();
    expect(mockPopulateR32).toHaveBeenCalled();
  });

  it("does NOT call seeding when not all GROUP_STAGE done (mixed statuses)", async () => {
    mockFetch.mockResolvedValue([
      apiGroupMatch({ utcDate: kickoff.toISOString(), status: "FINISHED" }),
      ...makeGroupMatches(71, 0).map((m, i) => ({ ...m, id: 200 + i })),
    ] as any);
    setupMocks({
      r32PopulatedCount: 0,
      rooms: [],
      dbMatches: [dbMatch({ kickoff, status: "scheduled", predictions: [] })],
    });

    await syncMatches();

    expect(mockComputeStandings).not.toHaveBeenCalled();
    expect(mockPopulateR32).not.toHaveBeenCalled();
  });

  it("does NOT call seeding when r32 is already fully populated (>= 16)", async () => {
    const matches72 = makeGroupMatches(72, 72);
    mockFetch.mockResolvedValue([
      {
        id: 100,
        utcDate: kickoff.toISOString(),
        status: "FINISHED",
        stage: "GROUP_STAGE",
        homeTeam: { id: 200, name: "Brazil", shortName: "Brazil", tla: "BRA" },
        awayTeam: { id: 201, name: "Germany", shortName: "Germany", tla: "GER" },
        score: { winner: "HOME_TEAM", fullTime: { home: 2, away: 1 } },
      },
      ...matches72.slice(1),
    ] as any);
    setupMocks({
      r32PopulatedCount: 16, // already fully populated
      rooms: [],
      dbMatches: [dbMatch({ kickoff, status: "scheduled", predictions: [] })],
    });

    await syncMatches();

    expect(mockComputeStandings).not.toHaveBeenCalled();
    expect(mockPopulateR32).not.toHaveBeenCalled();
  });

  it("does NOT call seeding when updated=0, even if all GROUP_STAGE are done", async () => {
    const matches72 = makeGroupMatches(72, 72);
    mockFetch.mockResolvedValue(matches72 as any);
    setupMocks({
      r32PopulatedCount: 0,
      rooms: [],
      dbMatches: [], // no DB matches → no match found → updated stays 0
    });

    await syncMatches();

    expect(mockComputeStandings).not.toHaveBeenCalled();
    expect(mockPopulateR32).not.toHaveBeenCalled();
  });
});

describe("11. Multiple rooms, derived status applied uniformly", () => {
  it("all auto-managed rooms get the same derived status on each sync", async () => {
    const matches72 = makeGroupMatches(72, 72);
    const pastKickoff = new Date(Date.now() - 60 * 60 * 1000);
    mockFetch.mockResolvedValue(matches72 as any);
    setupMocks({
      firstGroupKickoff: { kickoff: pastKickoff },
      // allGroupDone=true → correct status is ko_betting for every room
      rooms: [
        { id: "r1", status: "betting" },
        { id: "r2", status: "group_active" },
      ],
    });

    await syncMatches();

    expect(mockDb.room.update).toHaveBeenCalledWith({ where: { id: "r1" }, data: { status: "ko_betting" } });
    expect(mockDb.room.update).toHaveBeenCalledWith({ where: { id: "r2" }, data: { status: "ko_betting" } });
    expect(mockDb.room.update).toHaveBeenCalledTimes(2);
  });

  it("auto-corrects a ko_betting room back to group_active when group stage is not done (the premature transition bug)", async () => {
    // This is the real production bug: room jumped to ko_betting while group stage
    // was still ongoing. With derived-status logic it self-corrects on next sync.
    const partialMatches = makeGroupMatches(72, 20); // only 20 of 72 done
    const pastKickoff = new Date(Date.now() - 60 * 60 * 1000);
    mockFetch.mockResolvedValue(partialMatches as any);
    setupMocks({
      firstGroupKickoff: { kickoff: pastKickoff },
      rooms: [{ id: "r1", status: "ko_betting" }],
    });

    await syncMatches();

    expect(mockDb.room.update).toHaveBeenCalledWith({ where: { id: "r1" }, data: { status: "group_active" } });
  });

  it("does NOT update rooms already in the correct derived status", async () => {
    const partialMatches = makeGroupMatches(72, 20);
    const pastKickoff = new Date(Date.now() - 60 * 60 * 1000);
    mockFetch.mockResolvedValue(partialMatches as any);
    setupMocks({
      firstGroupKickoff: { kickoff: pastKickoff },
      rooms: [{ id: "r1", status: "group_active" }], // already correct
    });

    await syncMatches();

    expect(mockDb.room.update).not.toHaveBeenCalled();
  });

  it("auto-corrects a settling room back to ko_active when KO is running but Final not done (production bug fix)", async () => {
    // Production scenario: room was wrongly promoted to 'settling' because old
    // simulation data had a Final match marked finished in the real DB table.
    // After the fix, tournamentOver uses API only — no FINAL in API → self-correct.
    const pastKOKickoff = new Date(Date.now() - 30 * 60 * 1000);
    mockFetch.mockResolvedValue([apiGroupMatch({ status: "FINISHED" })] as any); // GROUP_STAGE only
    setupMocks({
      firstKOKickoff: { kickoff: pastKOKickoff },
      rooms: [{ id: "r1", status: "settling" }],
    });

    await syncMatches();

    // koStarted=true, tournamentOver=false → correctStatus=ko_active → settling self-corrects
    expect(mockDb.room.update).toHaveBeenCalledWith({ where: { id: "r1" }, data: { status: "ko_active" } });
  });

  it("never auto-manages 'finished' rooms regardless of tournament state", async () => {
    const matches72 = makeGroupMatches(72, 72);
    mockFetch.mockResolvedValue(matches72 as any);
    setupMocks({
      rooms: [{ id: "r1", status: "finished" }],
    });

    await syncMatches();

    // 'finished' is not in AUTO_MANAGED — admin confirmation is required
    expect(mockDb.room.update).not.toHaveBeenCalled();
  });

  it("does NOT update rooms when API returns empty response (hasReliableApiData guard)", async () => {
    // A temporary API outage should never roll back a legitimately advanced room.
    const pastKickoff = new Date(Date.now() - 60 * 60 * 1000);
    mockFetch.mockResolvedValue([]); // API outage
    setupMocks({
      firstGroupKickoff: { kickoff: pastKickoff }, // group started → would normally yield group_active
      rooms: [{ id: "r1", status: "ko_betting" }], // room is ahead of group_active
    });

    await syncMatches();

    // hasReliableApiData=false → skip all room status updates
    expect(mockDb.room.update).not.toHaveBeenCalled();
  });
});

describe("12. Result message format", () => {
  const kickoff = new Date("2026-06-12T15:00:00Z");

  beforeEach(() => {
    setupMocks({ rooms: [] });
  });

  it("uses singular 'match' when updated=1", async () => {
    mockFetch.mockResolvedValue([
      apiGroupMatch({ utcDate: kickoff.toISOString(), status: "FINISHED", score: { winner: "HOME_TEAM", fullTime: { home: 1, away: 0 } } }),
    ] as any);
    mockDb.match.findMany.mockResolvedValue([
      dbMatch({ kickoff, status: "scheduled", predictions: [] }),
    ]);

    const result = await syncMatches();

    expect(result.message).toMatch(/Updated 1 match,/);
    expect(result.message).not.toMatch(/matches/);
  });

  it("uses plural 'matches' when updated=3", async () => {
    const k1 = new Date("2026-06-12T15:00:00Z");
    const k2 = new Date("2026-06-12T18:00:00Z");
    const k3 = new Date("2026-06-12T21:00:00Z");
    mockFetch.mockResolvedValue([
      apiGroupMatch({ id: 1, utcDate: k1.toISOString(), status: "FINISHED", homeTeam: { id: 1, name: "Team1", shortName: "T1", tla: "T1" }, awayTeam: { id: 2, name: "Away1", shortName: "Away1", tla: "A1" }, score: { winner: "HOME_TEAM", fullTime: { home: 1, away: 0 } } }),
      apiGroupMatch({ id: 2, utcDate: k2.toISOString(), status: "FINISHED", homeTeam: { id: 3, name: "Team2", shortName: "T2", tla: "T2" }, awayTeam: { id: 4, name: "Away2", shortName: "Away2", tla: "A2" }, score: { winner: "HOME_TEAM", fullTime: { home: 2, away: 0 } } }),
      apiGroupMatch({ id: 3, utcDate: k3.toISOString(), status: "FINISHED", homeTeam: { id: 5, name: "Team3", shortName: "T3", tla: "T3" }, awayTeam: { id: 6, name: "Away3", shortName: "Away3", tla: "A3" }, score: { winner: "HOME_TEAM", fullTime: { home: 3, away: 0 } } }),
    ] as any);
    mockDb.match.findMany.mockResolvedValue([
      dbMatch({ id: "db-1", kickoff: k1, status: "scheduled", homeTeam: { id: "h1", name: "Team1", shortName: "T1", tla: "T1" }, awayTeam: { id: "a1", name: "Away1", shortName: "A1", tla: "A1" }, predictions: [] }),
      dbMatch({ id: "db-2", kickoff: k2, status: "scheduled", homeTeam: { id: "h2", name: "Team2", shortName: "T2", tla: "T2" }, awayTeam: { id: "a2", name: "Away2", shortName: "A2", tla: "A2" }, predictions: [] }),
      dbMatch({ id: "db-3", kickoff: k3, status: "scheduled", homeTeam: { id: "h3", name: "Team3", shortName: "T3", tla: "T3" }, awayTeam: { id: "a3", name: "Away3", shortName: "A3", tla: "A3" }, predictions: [] }),
    ]);

    const result = await syncMatches();

    expect(result.message).toMatch(/Updated 3 matches,/);
  });

  it("uses singular 'prediction' when predictionsScored=1", async () => {
    mockCalcPoints.mockReturnValue(3);
    mockFetch.mockResolvedValue([
      apiGroupMatch({ utcDate: kickoff.toISOString(), status: "FINISHED", score: { winner: "HOME_TEAM", fullTime: { home: 2, away: 1 } } }),
    ] as any);
    mockDb.match.findMany.mockResolvedValue([
      dbMatch({ kickoff, status: "scheduled", predictions: [{ id: "p1", homeScore: 1, awayScore: 0 }] }),
    ]);

    const result = await syncMatches();

    expect(result.message).toMatch(/scored 1 prediction$/);
    expect(result.message).not.toMatch(/predictions/);
  });

  it("uses plural 'predictions' when predictionsScored=5", async () => {
    mockCalcPoints.mockReturnValue(3);
    const preds = Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, homeScore: 1, awayScore: 0 }));
    mockFetch.mockResolvedValue([
      apiGroupMatch({ utcDate: kickoff.toISOString(), status: "FINISHED", score: { winner: "HOME_TEAM", fullTime: { home: 2, away: 1 } } }),
    ] as any);
    mockDb.match.findMany.mockResolvedValue([
      dbMatch({ kickoff, status: "scheduled", predictions: preds }),
    ]);

    const result = await syncMatches();

    expect(result.message).toMatch(/scored 5 predictions$/);
  });
});

describe("14. Stale reset pass", () => {
  const kickoff = new Date("2026-06-12T15:00:00Z");

  it("resets a DB match with sim status 'finished' when API reports SCHEDULED", async () => {
    mockFetch.mockResolvedValue([
      apiGroupMatch({ utcDate: kickoff.toISOString(), status: "SCHEDULED" }),
    ] as any);
    setupMocks({
      rooms: [],
      dbMatches: [dbMatch({ kickoff, status: "finished", homeScore: 2, awayScore: 1, predictions: [] })],
    });

    await syncMatches();

    expect(mockDb.match.update).toHaveBeenCalledWith({
      where: { id: "db-match-1" },
      data: { status: "scheduled", homeScore: null, awayScore: null },
    });
  });

  it("resets a DB match with non-null scores but scheduled status when API reports TIMED", async () => {
    mockFetch.mockResolvedValue([
      apiGroupMatch({ utcDate: kickoff.toISOString(), status: "TIMED" }),
    ] as any);
    setupMocks({
      rooms: [],
      dbMatches: [dbMatch({ kickoff, status: "scheduled", homeScore: 3, awayScore: 0, predictions: [] })],
    });

    await syncMatches();

    expect(mockDb.match.update).toHaveBeenCalledWith({
      where: { id: "db-match-1" },
      data: { status: "scheduled", homeScore: null, awayScore: null },
    });
  });

  it("does NOT reset a match the API correctly reports as FINISHED", async () => {
    mockFetch.mockResolvedValue([
      apiGroupMatch({ utcDate: kickoff.toISOString(), status: "FINISHED", score: { winner: "HOME_TEAM", fullTime: { home: 2, away: 1 } } }),
    ] as any);
    setupMocks({
      rooms: [],
      dbMatches: [dbMatch({ kickoff, status: "finished", homeScore: 2, awayScore: 1, predictions: [] })],
    });

    await syncMatches();

    // The unchanged check triggers (same state) — no update at all
    expect(mockDb.match.update).not.toHaveBeenCalled();
  });

  it("does NOT reset when API response is empty (hasReliableApiData guard)", async () => {
    mockFetch.mockResolvedValue([]);
    setupMocks({
      rooms: [],
      dbMatches: [dbMatch({ kickoff, status: "finished", homeScore: 2, awayScore: 1, predictions: [] })],
    });

    await syncMatches();

    expect(mockDb.match.update).not.toHaveBeenCalled();
  });

  it("does NOT reset a match with clean state (status=scheduled, null scores)", async () => {
    mockFetch.mockResolvedValue([
      apiGroupMatch({ utcDate: kickoff.toISOString(), status: "SCHEDULED" }),
    ] as any);
    setupMocks({
      rooms: [],
      dbMatches: [dbMatch({ kickoff, status: "scheduled", homeScore: null, awayScore: null, predictions: [] })],
    });

    await syncMatches();

    expect(mockDb.match.update).not.toHaveBeenCalled();
  });

  it("resets a 'live' match when the API says it is SCHEDULED (e.g. sim set it to live)", async () => {
    mockFetch.mockResolvedValue([
      apiGroupMatch({ utcDate: kickoff.toISOString(), status: "SCHEDULED" }),
    ] as any);
    setupMocks({
      rooms: [],
      dbMatches: [dbMatch({ kickoff, status: "live", homeScore: null, awayScore: null, predictions: [] })],
    });

    await syncMatches();

    expect(mockDb.match.update).toHaveBeenCalledWith({
      where: { id: "db-match-1" },
      data: { status: "scheduled", homeScore: null, awayScore: null },
    });
  });

  it("runs the stale reset even when actionable is empty (catches stale data between live matches)", async () => {
    // All API matches are SCHEDULED — no actionable, but stale reset still fires.
    mockFetch.mockResolvedValue([
      apiGroupMatch({ utcDate: kickoff.toISOString(), status: "SCHEDULED" }),
    ] as any);
    setupMocks({
      rooms: [],
      dbMatches: [dbMatch({ kickoff, status: "finished", homeScore: 1, awayScore: 0, predictions: [] })],
    });

    await syncMatches();

    // Stale reset fires and resets the match even though actionable is empty
    expect(mockDb.match.update).toHaveBeenCalledWith({
      where: { id: "db-match-1" },
      data: { status: "scheduled", homeScore: null, awayScore: null },
    });
  });

  it("resets stale group match even when seed kickoff differs by hours from API kickoff", async () => {
    // Regression: seed.ts uses fake kickoffs (3h apart from June 11); real API has actual
    // match times. The old 10-min kickoff guard caused stale data to never be found.
    const realApiKickoff = "2026-06-14T21:00:00Z";
    const seedKickoff = new Date("2026-06-12T03:00:00Z"); // completely different seed time
    mockFetch.mockResolvedValue([
      apiGroupMatch({ utcDate: realApiKickoff, status: "SCHEDULED" }),
    ] as any);
    setupMocks({
      rooms: [],
      dbMatches: [dbMatch({ kickoff: seedKickoff, status: "finished", homeScore: 2, awayScore: 0, predictions: [] })],
    });

    await syncMatches();

    expect(mockDb.match.update).toHaveBeenCalledWith({
      where: { id: "db-match-1" },
      data: { status: "scheduled", homeScore: null, awayScore: null },
    });
  });

  it("updates group match with real API scores even when seed kickoff differs by hours", async () => {
    // Same regression — main sync loop must also match by team names, not kickoff
    const realApiKickoff = "2026-06-14T21:00:00Z";
    const seedKickoff = new Date("2026-06-12T03:00:00Z");
    mockFetch.mockResolvedValue([
      apiGroupMatch({ utcDate: realApiKickoff, status: "FINISHED", score: { winner: "HOME_TEAM", fullTime: { home: 1, away: 0 } } }),
    ] as any);
    setupMocks({
      rooms: [],
      dbMatches: [dbMatch({ kickoff: seedKickoff, status: "finished", homeScore: 2, awayScore: 0, predictions: [] })],
    });

    await syncMatches();

    expect(mockDb.match.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "db-match-1" } })
    );
  });
});

describe("13. Notifications always called (when not early-returning)", () => {
  beforeEach(() => {
    mockFetch.mockResolvedValue([apiGroupMatch({ status: "FINISHED" })] as any);
    setupMocks({ rooms: [] });
  });

  it("calls checkAndSendRoundNotifications", async () => {
    await syncMatches();

    expect(mockNotifications).toHaveBeenCalledOnce();
  });

  it("calls checkAndSendIncompleteReminders", async () => {
    await syncMatches();

    expect(mockReminders).toHaveBeenCalledOnce();
  });

  it("notificationsSent in result equals value returned by checkAndSendRoundNotifications", async () => {
    const sent = [{ round: "R32", sent: 3 }];
    mockNotifications.mockResolvedValue(sent as any);

    const result = await syncMatches();

    expect(result.notificationsSent).toEqual(sent);
  });

  it("remindersSent in result equals value returned by checkAndSendIncompleteReminders", async () => {
    const sent = [{ round: "Group", sent: 5 }];
    mockReminders.mockResolvedValue(sent as any);

    const result = await syncMatches();

    expect(result.remindersSent).toEqual(sent);
  });

  it("notifications are called even when no matches are updated (updated=0)", async () => {
    // API has a FINISHED match but no matching DB match
    mockDb.match.findMany.mockResolvedValue([]);

    await syncMatches();

    expect(mockNotifications).toHaveBeenCalled();
    expect(mockReminders).toHaveBeenCalled();
  });
});

// ─── 15. Match table as pure API mirror ───────────────────────────────────────
// These tests encode the core invariant: sim data that found its way into the
// Match table (before the SimResult migration) must be corrected by the sync.
// They also serve as a regression guard for team name localisation issues
// (e.g. "South Korea" in our DB vs "Korea Republic" in the API) that caused
// the sync to silently skip every group stage match for weeks.

describe("15. Match table as pure API mirror", () => {
  beforeEach(() => setupMocks({ rooms: [] }));

  // ── fdId-based matching ───────────────────────────────────────────────────

  it("overwrites sim scores with real API result when match is FINISHED (fdId match)", async () => {
    mockFetch.mockResolvedValue([
      apiGroupMatch({
        status: "FINISHED",
        homeTeam: { id: 772, name: "Korea Republic", shortName: "South Korea", tla: "KOR" },
        awayTeam: { id: 800, name: "Mexico",         shortName: "Mexico",       tla: "MEX" },
        score: { winner: "HOME_TEAM", fullTime: { home: 2, away: 1 } },
      }),
    ] as any);
    mockDb.match.findMany.mockResolvedValue([
      dbMatch({
        status: "finished", homeScore: 3, awayScore: 0, // old sim score
        homeTeam: { id: "ht-1", fdId: 772, name: "South Korea", shortName: "South Korea", tla: "KOR" },
        awayTeam: { id: "at-1", fdId: 800, name: "Mexico",       shortName: "Mexico",       tla: "MEX" },
        predictions: [],
      }),
    ]);

    await syncMatches();

    expect(mockDb.match.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ homeScore: 2, awayScore: 1, status: "finished" }) })
    );
  });

  it("clears sim scores via stale-reset when API reports match is still SCHEDULED (fdId match)", async () => {
    mockFetch.mockResolvedValue([
      apiGroupMatch({
        status: "SCHEDULED",
        homeTeam: { id: 772, name: "Korea Republic", shortName: "South Korea", tla: "KOR" },
        awayTeam: { id: 800, name: "Mexico",         shortName: "Mexico",       tla: "MEX" },
        score: { winner: null, fullTime: { home: null, away: null } },
      }),
    ] as any);
    setupMocks({
      rooms: [],
      dbMatches: [dbMatch({
        status: "finished", homeScore: 2, awayScore: 0, // leftover sim score for a future game
        homeTeam: { id: "ht-1", fdId: 772, name: "South Korea", shortName: "South Korea", tla: "KOR" },
        awayTeam: { id: "at-1", fdId: 800, name: "Mexico",       shortName: "Mexico",       tla: "MEX" },
        predictions: [],
      })],
    });

    await syncMatches();

    expect(mockDb.match.update).toHaveBeenCalledWith({
      where: { id: "db-match-1" },
      data: { status: "scheduled", homeScore: null, awayScore: null },
    });
  });

  it("does NOT match a different team even if kickoff is identical (fdId guards against wrong match)", async () => {
    mockFetch.mockResolvedValue([
      apiGroupMatch({
        status: "FINISHED",
        homeTeam: { id: 773, name: "Argentina", shortName: "Argentina", tla: "ARG" }, // different fdId
        awayTeam: { id: 800, name: "Mexico",    shortName: "Mexico",    tla: "MEX" },
        score: { winner: "HOME_TEAM", fullTime: { home: 3, away: 0 } },
      }),
    ] as any);
    mockDb.match.findMany.mockResolvedValue([
      dbMatch({
        homeTeam: { id: "ht-1", fdId: 772, name: "South Korea", shortName: "South Korea", tla: "KOR" },
        awayTeam: { id: "at-1", fdId: 800, name: "Mexico",       shortName: "Mexico",       tla: "MEX" },
        predictions: [],
      }),
    ]);

    await syncMatches();

    expect(mockDb.match.update).not.toHaveBeenCalled();
  });

  // ── Name-fallback matching (before fdIds are populated) ───────────────────

  it("resolves 'South Korea' ↔ API shortName 'South Korea' when fdId not yet stored", async () => {
    // Our DB name: "South Korea". API official name: "Korea Republic", shortName: "South Korea".
    // This was the real root cause — fdId = null forces the name fallback path.
    mockFetch.mockResolvedValue([
      apiGroupMatch({
        status: "FINISHED",
        homeTeam: { id: 772, name: "Korea Republic", shortName: "South Korea", tla: "KOR" },
        awayTeam: { id: 800, name: "Mexico",         shortName: "Mexico",       tla: "MEX" },
        score: { winner: "HOME_TEAM", fullTime: { home: 1, away: 0 } },
      }),
    ] as any);
    mockDb.match.findMany.mockResolvedValue([
      dbMatch({
        status: "finished", homeScore: 2, awayScore: 0,
        homeTeam: { id: "ht-1", fdId: null, name: "South Korea", shortName: "South Korea", tla: "KOR" },
        awayTeam: { id: "at-1", fdId: null, name: "Mexico",       shortName: "Mexico",       tla: "MEX" },
        predictions: [],
      }),
    ]);

    await syncMatches();

    expect(mockDb.match.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "db-match-1" } })
    );
  });

  it("resolves 'Iran' ↔ API name 'IR Iran' via shortName when fdId not yet stored", async () => {
    mockFetch.mockResolvedValue([
      apiGroupMatch({
        status: "FINISHED",
        homeTeam: { id: 781, name: "IR Iran", shortName: "Iran", tla: "IRN" },
        awayTeam: { id: 800, name: "Mexico",  shortName: "Mexico", tla: "MEX" },
        score: { winner: "AWAY_TEAM", fullTime: { home: 0, away: 1 } },
      }),
    ] as any);
    mockDb.match.findMany.mockResolvedValue([
      dbMatch({
        status: "finished", homeScore: 1, awayScore: 0,
        homeTeam: { id: "ht-1", fdId: null, name: "Iran",   shortName: "Iran",   tla: "IRN" },
        awayTeam: { id: "at-1", fdId: null, name: "Mexico", shortName: "Mexico", tla: "MEX" },
        predictions: [],
      }),
    ]);

    await syncMatches();

    expect(mockDb.match.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "db-match-1" } })
    );
  });

  it("does NOT match when neither fdId nor any name field resolves to the same team", async () => {
    mockFetch.mockResolvedValue([
      apiGroupMatch({
        status: "FINISHED",
        homeTeam: { id: 773, name: "Argentina", shortName: "Argentina", tla: "ARG" },
        awayTeam: { id: 800, name: "Mexico",    shortName: "Mexico",    tla: "MEX" },
        score: { winner: "HOME_TEAM", fullTime: { home: 2, away: 0 } },
      }),
    ] as any);
    mockDb.match.findMany.mockResolvedValue([
      dbMatch({
        homeTeam: { id: "ht-1", fdId: null, name: "South Korea", shortName: "South Korea", tla: "KOR" },
        awayTeam: { id: "at-1", fdId: null, name: "Mexico",       shortName: "Mexico",       tla: "MEX" },
        predictions: [],
      }),
    ]);

    await syncMatches();

    expect(mockDb.match.update).not.toHaveBeenCalled();
  });
});
