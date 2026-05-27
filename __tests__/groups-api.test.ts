import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    roomMember: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    room: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    sideBet: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { auth } from "@auth";
import { db } from "@/lib/db";
import { GET, POST, PUT } from "@/app/api/groups/route";

const mockAuth = vi.mocked(auth);
const mockDb = db as any;

function makeRequest(body: unknown, method = "POST"): NextRequest {
  return new NextRequest("http://localhost/api/groups", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/groups", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null as any);
    const res = await GET();
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Unauthorized");
  });

  it("returns empty array when user has no groups", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    mockDb.roomMember.findMany.mockResolvedValue([]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("returns groups with entryFee, memberCount, sideBetCount", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    const now = new Date("2025-06-01T12:00:00Z");
    mockDb.roomMember.findMany.mockResolvedValue([
      {
        id: "rm1",
        userId: "u1",
        roomId: "r1",
        room: {
          id: "r1",
          name: "Test Group",
          inviteCode: "ABC123",
          entryFee: 10,
          status: "setup",
          createdAt: now,
          members: [{ id: "rm1" }, { id: "rm2" }],
          sideBets: [{ id: "sb1" }],
        },
      },
    ] as never);

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveLength(1);
    expect(json[0].entryFee).toBe(10);
    expect(json[0].memberCount).toBe(2);
    expect(json[0].sideBetCount).toBe(1);
    expect(json[0].status).toBe("setup");
  });
});

describe("POST /api/groups", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null as any);
    const res = await POST(makeRequest({ name: "My Group" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when name is missing", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/name/i);
  });

  it("returns 400 when name is blank", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    const res = await POST(makeRequest({ name: "   " }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when name exceeds 50 characters", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    const res = await POST(makeRequest({ name: "a".repeat(51) }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when entryFee is negative", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    const res = await POST(makeRequest({ name: "My Group", entryFee: -5 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/negative/i);
  });

  it("creates group with entryFee and auto-joins creator", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    const now = new Date("2025-06-01T12:00:00Z");
    const created = {
      id: "r1",
      name: "My Group",
      inviteCode: "XYZ",
      entryFee: 10,
      status: "setup",
      createdAt: now,
    };
    mockDb.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mockDb));
    (mockDb.room.create as ReturnType<typeof vi.fn>).mockResolvedValue(created);
    (mockDb.roomMember.create as ReturnType<typeof vi.fn>).mockResolvedValue({} as never);

    const res = await POST(makeRequest({ name: "My Group", entryFee: 10 }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.name).toBe("My Group");
    expect(json.entryFee).toBe(10);
    expect(json.memberCount).toBe(1);
    expect(json.status).toBe("setup");
    expect(mockDb.$transaction).toHaveBeenCalled();
  });

  it("defaults entryFee to 0 when not provided", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    const now = new Date();
    const created = {
      id: "r1",
      name: "Free Group",
      inviteCode: "FREE",
      entryFee: 0,
      status: "setup",
      createdAt: now,
    };
    mockDb.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mockDb));
    (mockDb.room.create as ReturnType<typeof vi.fn>).mockResolvedValue(created);
    (mockDb.roomMember.create as ReturnType<typeof vi.fn>).mockResolvedValue({} as never);

    const res = await POST(makeRequest({ name: "Free Group" }));
    expect(res.status).toBe(200);
    expect((await res.json()).entryFee).toBe(0);
  });
});

describe("PUT /api/groups", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null as any);
    const res = await PUT(makeRequest({ inviteCode: "ABC" }, "PUT"));
    expect(res.status).toBe(401);
  });

  it("returns 400 when inviteCode is missing", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    const res = await PUT(makeRequest({}, "PUT"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/invite code/i);
  });

  it("returns 404 when room not found", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    mockDb.room.findUnique.mockResolvedValue(null);
    const res = await PUT(makeRequest({ inviteCode: "UNKNOWN" }, "PUT"));
    expect(res.status).toBe(404);
  });

  it("joins room when not already a member", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u2" } } as never);
    const now = new Date("2025-06-01T12:00:00Z");
    mockDb.room.findUnique.mockResolvedValue({
      id: "r1",
      name: "Test Group",
      inviteCode: "ABC123",
      entryFee: 5,
      status: "open",
      createdAt: now,
      members: [{ id: "rm1", userId: "u1", roomId: "r1" }],
      sideBets: [],
    } as never);
    mockDb.roomMember.create.mockResolvedValue({} as never);

    const res = await PUT(makeRequest({ inviteCode: "ABC123" }, "PUT"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.memberCount).toBe(2);
    expect(mockDb.roomMember.create).toHaveBeenCalled();
  });

  it("does not duplicate membership when already a member", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    const now = new Date("2025-06-01T12:00:00Z");
    mockDb.room.findUnique.mockResolvedValue({
      id: "r1",
      name: "Test Group",
      inviteCode: "ABC123",
      entryFee: 5,
      status: "open",
      createdAt: now,
      members: [{ id: "rm1", userId: "u1", roomId: "r1" }],
      sideBets: [],
    } as never);

    const res = await PUT(makeRequest({ inviteCode: "ABC123" }, "PUT"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.memberCount).toBe(1);
    expect(mockDb.roomMember.create).not.toHaveBeenCalled();
  });
});
