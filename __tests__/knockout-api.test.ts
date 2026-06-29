import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    roomMember: { findUnique: vi.fn() },
    room: { findUnique: vi.fn() },
    match: { findMany: vi.fn() },
    kOPrediction: { findMany: vi.fn(), upsert: vi.fn(), groupBy: vi.fn() },
    simResult: { findMany: vi.fn() },
    team: { findMany: vi.fn() },
  },
}));

import { auth } from "@auth";
import { db } from "@/lib/db";
import { roundOfMatchNumber } from "@/lib/ko-bracket";
import { GET, POST } from "@/app/api/groups/[roomId]/knockout/route";

const mockAuth = vi.mocked(auth);
const mockDb = db as any;
const PARAMS = Promise.resolve({ roomId: "r1" });

// ─── shared fixtures ─────────────────────────────────────────────────────────

const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30d from now
const PAST   = new Date(Date.now() - 60 * 60 * 1000);            // 1h ago

const KO_MATCH = {
  id: "m1",
  round: "R32",
  group: null,
  matchNumber: 73,
  kickoff: FUTURE,
  status: "scheduled",
  homeScore: null,
  awayScore: null,
  homeTeam: { id: "bra", name: "Brazil", flag: "🇧🇷" },
  awayTeam: { id: "ger", name: "Germany", flag: "🇩🇪" },
};

function makeGetRequest() {
  return new Request("http://localhost/api/groups/r1/knockout");
}

function makePostRequest(body: unknown) {
  return new NextRequest("http://localhost/api/groups/r1/knockout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ─── GET ─────────────────────────────────────────────────────────────────────

describe("GET /api/groups/[roomId]/knockout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "u1", role: "user" } } as never);
    mockDb.roomMember.findUnique.mockResolvedValue({ userId: "u1", roomId: "r1" });
    mockDb.room.findUnique.mockResolvedValue({ status: "ko_betting", simulationMode: false, entryFee: 10, members: [] });
    mockDb.match.findMany.mockResolvedValue([KO_MATCH]);
    mockDb.kOPrediction.findMany.mockResolvedValue([]);
    mockDb.kOPrediction.groupBy.mockResolvedValue([]);
    mockDb.simResult.findMany.mockResolvedValue([]);
    mockDb.team.findMany.mockResolvedValue([]);
  });

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null as never);
    const res = await GET(makeGetRequest(), { params: PARAMS });
    expect(res.status).toBe(401);
  });

  it("returns 403 when not a room member", async () => {
    mockDb.roomMember.findUnique.mockResolvedValue(null);
    const res = await GET(makeGetRequest(), { params: PARAMS });
    expect(res.status).toBe(403);
  });

  it("returns empty array when room status is 'betting' (not KO-visible)", async () => {
    mockDb.room.findUnique.mockResolvedValue({ status: "betting", simulationMode: false });
    const res = await GET(makeGetRequest(), { params: PARAMS });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("returns empty array when room status is 'group_active'", async () => {
    mockDb.room.findUnique.mockResolvedValue({ status: "group_active", simulationMode: false });
    const res = await GET(makeGetRequest(), { params: PARAMS });
    expect(await res.json()).toEqual([]);
  });

  it.each(["ko_betting", "ko_active", "settling", "finished"])(
    "returns matches when room status is %s",
    async (status) => {
      mockDb.room.findUnique.mockResolvedValue({ status, simulationMode: false, entryFee: 10, members: [] });
      const res = await GET(makeGetRequest(), { params: PARAMS });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(1);
    }
  );

  it("sets predicted:false when user has no prediction for a match", async () => {
    const res = await GET(makeGetRequest(), { params: PARAMS });
    const body = await res.json();
    expect(body[0].predicted).toBe(false);
  });

  it("sets predicted:true and merges scores when user has a prediction", async () => {
    mockDb.kOPrediction.findMany.mockResolvedValue([
      { matchId: "m1", homeScore: 2, awayScore: 1, penaltyWinner: null, earnedAmount: null },
    ]);
    const res = await GET(makeGetRequest(), { params: PARAMS });
    const body = await res.json();
    expect(body[0].predicted).toBe(true);
    expect(body[0].homeScore).toBe(2);
    expect(body[0].awayScore).toBe(1);
  });

  it("falls back to 0-0 scores when no prediction exists", async () => {
    const res = await GET(makeGetRequest(), { params: PARAMS });
    const body = await res.json();
    expect(body[0].homeScore).toBe(0);
    expect(body[0].awayScore).toBe(0);
  });

  it("returns match teams and round in the match sub-object", async () => {
    const res = await GET(makeGetRequest(), { params: PARAMS });
    const body = await res.json();
    expect(body[0].match.round).toBe("R32");
    expect(body[0].match.homeTeam.name).toBe("Brazil");
    expect(body[0].match.awayTeam.name).toBe("Germany");
  });

  // Bracket-positioning contract: the visual bracket places every KO match by
  // its matchNumber + round (see src/lib/ko-bracket.ts BRACKET_POSITIONS), so
  // the API must return both, with a matchNumber inside the KO range 73‑104.
  it("returns a KO matchNumber and round the bracket can position", async () => {
    const res = await GET(makeGetRequest(), { params: PARAMS });
    const body = await res.json();
    expect(body[0].match.matchNumber).toBe(73);
    expect(body[0].match.matchNumber).toBeGreaterThanOrEqual(73);
    expect(body[0].match.matchNumber).toBeLessThanOrEqual(104);
    expect(roundOfMatchNumber(body[0].match.matchNumber)).toBe(body[0].match.round);
  });

  it("simulation mode: overlays SimResult teams onto the match", async () => {
    mockDb.room.findUnique.mockResolvedValue({ status: "ko_betting", simulationMode: true, entryFee: 10, members: [] });
    mockDb.simResult.findMany.mockResolvedValue([
      { matchId: "m1", homeTeamId: "fra", awayTeamId: "esp", homeScore: null, awayScore: null },
    ]);
    mockDb.team.findMany.mockResolvedValue([
      { id: "fra", name: "France", flag: "🇫🇷" },
      { id: "esp", name: "Spain", flag: "🇪🇸" },
    ]);
    const res = await GET(makeGetRequest(), { params: PARAMS });
    const body = await res.json();
    expect(body[0].match.homeTeam.name).toBe("France");
    expect(body[0].match.awayTeam.name).toBe("Spain");
  });

  it("simulation mode: overlays SimResult scores and marks match finished", async () => {
    mockDb.room.findUnique.mockResolvedValue({ status: "ko_active", simulationMode: true, entryFee: 10, members: [] });
    mockDb.simResult.findMany.mockResolvedValue([
      { matchId: "m1", homeTeamId: null, awayTeamId: null, homeScore: 3, awayScore: 2 },
    ]);
    mockDb.team.findMany.mockResolvedValue([]);
    const res = await GET(makeGetRequest(), { params: PARAMS });
    const body = await res.json();
    expect(body[0].match.homeScore).toBe(3);
    expect(body[0].match.awayScore).toBe(2);
    expect(body[0].match.status).toBe("finished");
  });

  it("simulation mode: status stays non-finished when SimResult has no scores", async () => {
    mockDb.room.findUnique.mockResolvedValue({ status: "ko_betting", simulationMode: true, entryFee: 10, members: [] });
    mockDb.simResult.findMany.mockResolvedValue([
      { matchId: "m1", homeTeamId: "fra", awayTeamId: "esp", homeScore: null, awayScore: null },
    ]);
    mockDb.team.findMany.mockResolvedValue([
      { id: "fra", name: "France", flag: "🇫🇷" },
      { id: "esp", name: "Spain", flag: "🇪🇸" },
    ]);
    const res = await GET(makeGetRequest(), { params: PARAMS });
    const body = await res.json();
    expect(body[0].match.status).toBe("scheduled"); // original status, not overridden
  });
});

// ─── POST ─────────────────────────────────────────────────────────────────────

describe("POST /api/groups/[roomId]/knockout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    mockDb.roomMember.findUnique.mockResolvedValue({ userId: "u1", roomId: "r1" });
    mockDb.room.findUnique.mockResolvedValue({ status: "ko_betting" });
    mockDb.match.findMany.mockResolvedValue([
      { id: "m1", kickoff: FUTURE, status: "scheduled", round: "R32" },
    ]);
    mockDb.kOPrediction.upsert.mockResolvedValue({});
  });

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null as never);
    const res = await POST(makePostRequest({ predictions: [] }), { params: PARAMS });
    expect(res.status).toBe(401);
  });

  it("returns 403 when not a room member", async () => {
    mockDb.roomMember.findUnique.mockResolvedValue(null);
    const res = await POST(makePostRequest({ predictions: [] }), { params: PARAMS });
    expect(res.status).toBe(403);
  });

  it("returns 403 when room status is not ko_betting", async () => {
    mockDb.room.findUnique.mockResolvedValue({ status: "ko_active" });
    const res = await POST(
      makePostRequest({ predictions: [{ matchId: "m1", homeScore: 2, awayScore: 1 }] }),
      { params: PARAMS }
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/not open/i);
  });

  it("admin override: room creator can edit a member's bracket in ko_active, bypassing the lock", async () => {
    mockDb.room.findUnique.mockResolvedValue({ status: "ko_active", creatorId: "u1" }); // u1 is creator
    const res = await POST(
      makePostRequest({ targetUserId: "u2", predictions: [{ matchId: "m1", homeScore: 2, awayScore: 1 }] }),
      { params: PARAMS }
    );
    expect(res.status).toBe(200);
    // Upsert is written for the TARGET member, not the admin.
    expect(mockDb.kOPrediction.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_matchId_roomId: { userId: "u2", matchId: "m1", roomId: "r1" } },
      }),
    );
  });

  it("non-admin cannot use targetUserId to bypass the lock (still 403 in ko_active)", async () => {
    mockDb.room.findUnique.mockResolvedValue({ status: "ko_active", creatorId: "someoneElse" });
    const res = await POST(
      makePostRequest({ targetUserId: "u2", predictions: [{ matchId: "m1", homeScore: 2, awayScore: 1 }] }),
      { params: PARAMS }
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 when predictions array is empty", async () => {
    const res = await POST(makePostRequest({ predictions: [] }), { params: PARAMS });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid JSON body", async () => {
    const req = new NextRequest("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    const res = await POST(req, { params: PARAMS });
    expect(res.status).toBe(400);
  });

  it("rejects prediction for a match whose kickoff has already passed", async () => {
    mockDb.match.findMany.mockResolvedValue([
      { id: "m1", kickoff: PAST, status: "scheduled" },
    ]);
    const res = await POST(
      makePostRequest({ predictions: [{ matchId: "m1", homeScore: 1, awayScore: 0 }] }),
      { params: PARAMS }
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/locked|invalid/i);
  });

  it("rejects prediction for a live match", async () => {
    mockDb.match.findMany.mockResolvedValue([
      { id: "m1", kickoff: FUTURE, status: "live" },
    ]);
    const res = await POST(
      makePostRequest({ predictions: [{ matchId: "m1", homeScore: 1, awayScore: 0 }] }),
      { params: PARAMS }
    );
    expect(res.status).toBe(400);
  });

  it("rejects prediction for a finished match", async () => {
    mockDb.match.findMany.mockResolvedValue([
      { id: "m1", kickoff: FUTURE, status: "finished" },
    ]);
    const res = await POST(
      makePostRequest({ predictions: [{ matchId: "m1", homeScore: 1, awayScore: 0 }] }),
      { params: PARAMS }
    );
    expect(res.status).toBe(400);
  });

  it("rejects scores below 0", async () => {
    const res = await POST(
      makePostRequest({ predictions: [{ matchId: "m1", homeScore: -1, awayScore: 0 }] }),
      { params: PARAMS }
    );
    expect(res.status).toBe(400);
  });

  it("rejects scores above 20", async () => {
    const res = await POST(
      makePostRequest({ predictions: [{ matchId: "m1", homeScore: 21, awayScore: 0 }] }),
      { params: PARAMS }
    );
    expect(res.status).toBe(400);
  });

  it("rejects a draw (equal scores) without penaltyWinner", async () => {
    const res = await POST(
      makePostRequest({ predictions: [{ matchId: "m1", homeScore: 1, awayScore: 1, penaltyWinner: null }] }),
      { params: PARAMS }
    );
    expect(res.status).toBe(400);
  });

  it("accepts a draw with penaltyWinner 'home'", async () => {
    const res = await POST(
      makePostRequest({ predictions: [{ matchId: "m1", homeScore: 1, awayScore: 1, penaltyWinner: "home" }] }),
      { params: PARAMS }
    );
    expect(res.status).toBe(200);
    expect((await res.json()).saved).toBe(1);
  });

  it("accepts a draw with penaltyWinner 'away'", async () => {
    const res = await POST(
      makePostRequest({ predictions: [{ matchId: "m1", homeScore: 2, awayScore: 2, penaltyWinner: "away" }] }),
      { params: PARAMS }
    );
    expect(res.status).toBe(200);
  });

  it("saves a valid non-draw prediction and returns saved count", async () => {
    const res = await POST(
      makePostRequest({ predictions: [{ matchId: "m1", homeScore: 2, awayScore: 1 }] }),
      { params: PARAMS }
    );
    expect(res.status).toBe(200);
    expect((await res.json()).saved).toBe(1);
    expect(mockDb.kOPrediction.upsert).toHaveBeenCalledTimes(1);
  });

  it("upserts with the correct userId, matchId, roomId", async () => {
    await POST(
      makePostRequest({ predictions: [{ matchId: "m1", homeScore: 2, awayScore: 0 }] }),
      { params: PARAMS }
    );
    expect(mockDb.kOPrediction.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_matchId_roomId: { userId: "u1", matchId: "m1", roomId: "r1" } },
        create: expect.objectContaining({ userId: "u1", matchId: "m1", roomId: "r1" }),
      })
    );
  });

  it("stores null penaltyWinner for non-draw predictions", async () => {
    await POST(
      makePostRequest({ predictions: [{ matchId: "m1", homeScore: 3, awayScore: 1 }] }),
      { params: PARAMS }
    );
    const call = mockDb.kOPrediction.upsert.mock.calls[0][0];
    expect(call.create.penaltyWinner).toBeNull();
  });

  it("stores penaltyWinner for draw predictions in create", async () => {
    await POST(
      makePostRequest({ predictions: [{ matchId: "m1", homeScore: 1, awayScore: 1, penaltyWinner: "home" }] }),
      { params: PARAMS }
    );
    const call = mockDb.kOPrediction.upsert.mock.calls[0][0];
    expect(call.create.penaltyWinner).toBe("home");
  });

  it("resets earnedAmount to null on update (re-prediction)", async () => {
    await POST(
      makePostRequest({ predictions: [{ matchId: "m1", homeScore: 2, awayScore: 0 }] }),
      { params: PARAMS }
    );
    const call = mockDb.kOPrediction.upsert.mock.calls[0][0];
    expect(call.update.earnedAmount).toBeNull();
  });

  it("saves multiple valid predictions and returns correct count", async () => {
    mockDb.match.findMany.mockResolvedValue([
      { id: "m1", kickoff: FUTURE, status: "scheduled", round: "R32" },
      { id: "m2", kickoff: FUTURE, status: "scheduled", round: "R32" },
    ]);
    const res = await POST(
      makePostRequest({
        predictions: [
          { matchId: "m1", homeScore: 2, awayScore: 1 },
          { matchId: "m2", homeScore: 0, awayScore: 0, penaltyWinner: "away" },
        ],
      }),
      { params: PARAMS }
    );
    expect((await res.json()).saved).toBe(2);
    expect(mockDb.kOPrediction.upsert).toHaveBeenCalledTimes(2);
  });

  it("silently skips predictions for unknown matchIds", async () => {
    const res = await POST(
      makePostRequest({ predictions: [{ matchId: "unknown", homeScore: 1, awayScore: 0 }] }),
      { params: PARAMS }
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/locked|invalid/i);
  });
});
