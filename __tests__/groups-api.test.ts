import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/tournament-lock", () => ({ isTournamentStarted: vi.fn() }));
vi.mock("@/lib/email", () => ({
  emailMemberJoined: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: {
    roomMember: { findMany: vi.fn(), create: vi.fn() },
    room: { create: vi.fn(), findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    sideBet: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { auth } from "@auth";
import { db } from "@/lib/db";
import { isTournamentStarted } from "@/lib/tournament-lock";
import { GET, POST, PUT } from "@/app/api/groups/route";

const mockAuth = vi.mocked(auth);
const mockDb = db as any;
const mockTournamentStarted = vi.mocked(isTournamentStarted);

function makeRequest(body: unknown, method = "POST"): NextRequest {
  return new NextRequest("http://localhost/api/groups", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTournamentStarted.mockResolvedValue(false);
  mockDb.user.findUnique.mockResolvedValue(null);
});

describe("GET /api/groups", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null as any);
    expect((await GET()).status).toBe(401);
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
    mockDb.roomMember.findMany.mockResolvedValue([{
      id: "rm1", userId: "u1", roomId: "r1",
      room: {
        id: "r1", name: "Test Group", inviteCode: "ABC123", entryFee: 10,
        status: "setup", createdAt: new Date("2025-06-01"),
        members: [{ id: "rm1" }, { id: "rm2" }],
        sideBets: [{ id: "sb1" }],
      },
    }] as never);
    const json = await (await GET()).json();
    expect(json[0].entryFee).toBe(10);
    expect(json[0].memberCount).toBe(2);
    expect(json[0].sideBetCount).toBe(1);
  });
});

describe("POST /api/groups", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null as any);
    expect((await POST(makeRequest({ name: "X" }))).status).toBe(401);
  });

  it("returns 403 when tournament has started", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    mockTournamentStarted.mockResolvedValue(true);
    expect((await POST(makeRequest({ name: "X" }))).status).toBe(403);
  });

  it("returns 400 when name is missing", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    expect((await POST(makeRequest({}))).status).toBe(400);
  });

  it("returns 400 when name is blank", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    expect((await POST(makeRequest({ name: "   " }))).status).toBe(400);
  });

  it("returns 400 when name exceeds 50 characters", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    expect((await POST(makeRequest({ name: "a".repeat(51) }))).status).toBe(400);
  });

  it("returns 400 when entryFee is negative", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    const res = await POST(makeRequest({ name: "X", entryFee: -5 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/negative/i);
  });

  it("creates group and auto-joins creator", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    const created = { id: "r1", name: "My Group", inviteCode: "XYZ", entryFee: 10, status: "setup", createdAt: new Date() };
    mockDb.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mockDb));
    mockDb.room.create.mockResolvedValue(created);
    mockDb.roomMember.create.mockResolvedValue({});
    const res = await POST(makeRequest({ name: "My Group", entryFee: 10 }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.name).toBe("My Group");
    expect(json.memberCount).toBe(1);
  });

  it("defaults entryFee to 0 when not provided", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    const created = { id: "r1", name: "Free", inviteCode: "FREE", entryFee: 0, status: "setup", createdAt: new Date() };
    mockDb.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mockDb));
    mockDb.room.create.mockResolvedValue(created);
    mockDb.roomMember.create.mockResolvedValue({});
    expect((await (await POST(makeRequest({ name: "Free" }))).json()).entryFee).toBe(0);
  });
});

describe("PUT /api/groups", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null as any);
    expect((await PUT(makeRequest({ inviteCode: "X" }, "PUT"))).status).toBe(401);
  });

  it("returns 403 when tournament has started", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    mockTournamentStarted.mockResolvedValue(true);
    expect((await PUT(makeRequest({ inviteCode: "X" }, "PUT"))).status).toBe(403);
  });

  it("returns 400 when inviteCode is missing", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    expect((await PUT(makeRequest({}, "PUT"))).status).toBe(400);
  });

  it("returns 404 when room not found", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    mockDb.room.findUnique.mockResolvedValue(null);
    expect((await PUT(makeRequest({ inviteCode: "NOPE" }, "PUT"))).status).toBe(404);
  });

  it("joins room when not already a member", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u2" } } as never);
    mockDb.room.findUnique.mockResolvedValue({
      id: "r1", name: "Group", inviteCode: "ABC", entryFee: 5, status: "open",
      createdAt: new Date(), members: [{ userId: "u1" }], sideBets: [],
    } as never);
    mockDb.roomMember.create.mockResolvedValue({});
    mockDb.user.findUnique.mockResolvedValue({ name: "Bob" });
    const res = await PUT(makeRequest({ inviteCode: "ABC" }, "PUT"));
    expect(res.status).toBe(200);
    expect((await res.json()).memberCount).toBe(2);
    expect(mockDb.roomMember.create).toHaveBeenCalled();
  });

  it("does not duplicate membership when already a member", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    mockDb.room.findUnique.mockResolvedValue({
      id: "r1", name: "Group", inviteCode: "ABC", entryFee: 5, status: "open",
      createdAt: new Date(), members: [{ userId: "u1" }], sideBets: [],
    } as never);
    const res = await PUT(makeRequest({ inviteCode: "ABC" }, "PUT"));
    expect(res.status).toBe(200);
    expect((await res.json()).memberCount).toBe(1);
    expect(mockDb.roomMember.create).not.toHaveBeenCalled();
  });
});
