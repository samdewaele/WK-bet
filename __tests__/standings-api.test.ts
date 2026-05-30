import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    roomMember: {
      findUnique: vi.fn(),
    },
    room: {
      findUnique: vi.fn(),
    },
    team: {
      findMany: vi.fn(),
    },
    match: {
      findFirst: vi.fn(),
    },
    groupStandingPrediction: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

import { auth } from "@auth";
import { db } from "@/lib/db";
import { GET, POST } from "@/app/api/groups/[roomId]/standings/route";

const mockAuth = vi.mocked(auth);
const mockDb = db as any;

const PARAMS = Promise.resolve({ roomId: "room1" });

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/groups/room1/standings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validTeams = [
  { id: "t1", name: "Brazil", flag: "🇧🇷", group: "A" },
  { id: "t2", name: "Germany", flag: "🇩🇪", group: "A" },
  { id: "t3", name: "France", flag: "🇫🇷", group: "A" },
  { id: "t4", name: "Spain", flag: "🇪🇸", group: "A" },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.room.findUnique.mockResolvedValue({ status: "open" });
});

describe("GET /api/groups/[roomId]/standings", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null as any);
    const res = await GET({} as never, { params: PARAMS });
    expect(res.status).toBe(401);
  });

  it("returns 403 when not a member", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    mockDb.roomMember.findUnique.mockResolvedValue(null);
    const res = await GET({} as never, { params: PARAMS });
    expect(res.status).toBe(403);
  });

  it("returns predictions for the user", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    mockDb.roomMember.findUnique.mockResolvedValue({ id: "rm1" } as never);
    mockDb.groupStandingPrediction.findMany.mockResolvedValue([
      {
        id: "gp1",
        wcGroup: "A",
        position1: "t1",
        position2: "t2",
        position3: "t3",
        position4: "t4",
        earnedAmount: null,
      },
    ] as never);

    const res = await GET({} as never, { params: PARAMS });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveLength(1);
    expect(json[0].wcGroup).toBe("A");
  });
});

describe("POST /api/groups/[roomId]/standings", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null as any);
    const res = await POST(makeRequest({}), { params: PARAMS });
    expect(res.status).toBe(401);
  });

  it("returns 403 when not a member", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    mockDb.roomMember.findUnique.mockResolvedValue(null);
    const res = await POST(makeRequest({ predictions: [] }), { params: PARAMS });
    expect(res.status).toBe(403);
  });

  it("returns 400 when predictions array is empty", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    mockDb.roomMember.findUnique.mockResolvedValue({ id: "rm1" } as never);
    const res = await POST(makeRequest({ predictions: [] }), { params: PARAMS });
    expect(res.status).toBe(400);
  });

  it("rejects prediction with duplicate teams", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    mockDb.roomMember.findUnique.mockResolvedValue({ id: "rm1" } as never);

    const pred = {
      wcGroup: "A",
      position1: "t1",
      position2: "t1",
      position3: "t3",
      position4: "t4",
    };

    const res = await POST(makeRequest({ predictions: [pred] }), { params: PARAMS });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.details?.[0]).toMatch(/different/i);
  });

  it("rejects prediction when teams don't belong to the WC group", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    mockDb.roomMember.findUnique.mockResolvedValue({ id: "rm1" } as never);
    mockDb.team.findMany.mockResolvedValue([
      { id: "t1" },
      { id: "t2" },
    ] as never);

    const pred = {
      wcGroup: "A",
      position1: "t1",
      position2: "t2",
      position3: "wrong1",
      position4: "wrong2",
    };

    const res = await POST(makeRequest({ predictions: [pred] }), { params: PARAMS });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.details?.[0]).toMatch(/invalid team/i);
  });

  it("rejects prediction when group is locked (match has kicked off)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    mockDb.roomMember.findUnique.mockResolvedValue({ id: "rm1" } as never);
    mockDb.team.findMany.mockResolvedValue(validTeams as never);
    mockDb.match.findFirst.mockResolvedValue({
      id: "m1",
      kickoff: new Date(Date.now() - 3600000),
    } as never);

    const pred = {
      wcGroup: "A",
      position1: "t1",
      position2: "t2",
      position3: "t3",
      position4: "t4",
    };

    const res = await POST(makeRequest({ predictions: [pred] }), { params: PARAMS });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.details?.[0]).toMatch(/locked/i);
  });

  it("returns 403 when room predictions are locked", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    mockDb.roomMember.findUnique.mockResolvedValue({ id: "rm1" } as never);
    mockDb.room.findUnique.mockResolvedValue({ status: "closed" });

    const pred = { wcGroup: "A", position1: "t1", position2: "t2", position3: "t3", position4: "t4" };
    const res = await POST(makeRequest({ predictions: [pred] }), { params: PARAMS });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/locked/i);
  });

  it("upserts valid prediction", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    mockDb.roomMember.findUnique.mockResolvedValue({ id: "rm1" } as never);
    mockDb.team.findMany.mockResolvedValue(validTeams as never);
    mockDb.match.findFirst.mockResolvedValue(null);
    mockDb.groupStandingPrediction.upsert.mockResolvedValue({
      id: "gp1",
      wcGroup: "A",
      position1: "t1",
      position2: "t2",
      position3: "t3",
      position4: "t4",
    } as never);

    const pred = {
      wcGroup: "A",
      position1: "t1",
      position2: "t2",
      position3: "t3",
      position4: "t4",
    };

    const res = await POST(makeRequest({ predictions: [pred] }), { params: PARAMS });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.saved).toBe(1);
    expect(mockDb.groupStandingPrediction.upsert).toHaveBeenCalledTimes(1);
  });

  it("returns partial results when some predictions are valid and some are not", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    mockDb.roomMember.findUnique.mockResolvedValue({ id: "rm1" } as never);

    mockDb.team.findMany
      .mockResolvedValueOnce(validTeams as never)
      .mockResolvedValueOnce([] as never);

    mockDb.match.findFirst.mockResolvedValue(null);
    mockDb.groupStandingPrediction.upsert.mockResolvedValue({} as never);

    const preds = [
      { wcGroup: "A", position1: "t1", position2: "t2", position3: "t3", position4: "t4" },
      { wcGroup: "B", position1: "x1", position2: "x2", position3: "x3", position4: "x4" },
    ];

    const res = await POST(makeRequest({ predictions: preds }), { params: PARAMS });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.saved).toBe(1);
    expect(json.errors).toHaveLength(1);
  });

  it("returns 400 when all predictions require missing fields", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    mockDb.roomMember.findUnique.mockResolvedValue({ id: "rm1" } as never);

    const pred = { wcGroup: "A", position1: "t1" };

    const res = await POST(makeRequest({ predictions: [pred] }), { params: PARAMS });
    expect(res.status).toBe(400);
  });
});
