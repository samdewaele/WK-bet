import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/tournament-lock", () => ({ isTournamentStarted: vi.fn() }));
vi.mock("@/lib/email", () => ({
  emailMemberLeft: vi.fn().mockResolvedValue(undefined),
  emailRemovedFromGroup: vi.fn().mockResolvedValue(undefined),
  emailMemberRemovedByAdmin: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/db", () => ({
  db: {
    room: { findUnique: vi.fn() },
    roomMember: { delete: vi.fn(), update: vi.fn() },
    prediction: { deleteMany: vi.fn() },
    kOPrediction: { deleteMany: vi.fn() },
    groupStandingPrediction: { deleteMany: vi.fn() },
    sideBet: { updateMany: vi.fn() },
    sideBetEntry: { findMany: vi.fn(), deleteMany: vi.fn() },
    p2PSideBet: { updateMany: vi.fn() },
  },
}));

import { auth } from "@auth";
import { db } from "@/lib/db";
import { isTournamentStarted } from "@/lib/tournament-lock";
import { PATCH, DELETE } from "@/app/api/groups/[roomId]/members/[targetUserId]/route";

const mockAuth = vi.mocked(auth);
const mockDb = db as any;
const mockTournamentStarted = vi.mocked(isTournamentStarted);

const PARAMS = (targetUserId = "u2") =>
  Promise.resolve({ roomId: "r1", targetUserId });

function patchRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const baseRoom = {
  id: "r1",
  name: "Test Group",
  creatorId: "u1",
  creator: { id: "u1", name: "Creator", email: "creator@test.com" },
  members: [
    { userId: "u1", user: { id: "u1", name: "Creator", email: "creator@test.com" } },
    { userId: "u2", user: { id: "u2", name: "Bob", email: "bob@test.com" } },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockTournamentStarted.mockResolvedValue(false);
  mockDb.prediction.deleteMany.mockResolvedValue({});
  mockDb.kOPrediction.deleteMany.mockResolvedValue({});
  mockDb.groupStandingPrediction.deleteMany.mockResolvedValue({});
  mockDb.sideBet.updateMany.mockResolvedValue({});
  mockDb.sideBetEntry.findMany.mockResolvedValue([]);
  mockDb.sideBetEntry.deleteMany.mockResolvedValue({});
  mockDb.p2PSideBet.updateMany.mockResolvedValue({});
  mockDb.roomMember.delete.mockResolvedValue({});
});

describe("DELETE /api/groups/[roomId]/members/[targetUserId]", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null as any);
    expect((await DELETE({} as Request, { params: PARAMS() })).status).toBe(401);
  });

  it("returns 403 when tournament has started", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u2" } } as never);
    mockTournamentStarted.mockResolvedValue(true);
    expect((await DELETE({} as Request, { params: PARAMS() })).status).toBe(403);
  });

  it("returns 404 when room not found", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u2" } } as never);
    mockDb.room.findUnique.mockResolvedValue(null);
    expect((await DELETE({} as Request, { params: PARAMS() })).status).toBe(404);
  });

  it("returns 403 when non-manager tries to remove someone else", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u3", role: "user" } } as never);
    mockDb.room.findUnique.mockResolvedValue({ ...baseRoom, creatorId: "u1" });
    expect((await DELETE({} as Request, { params: PARAMS("u2") })).status).toBe(403);
  });

  it("returns 400 when creator tries to leave their own group", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    mockDb.room.findUnique.mockResolvedValue(baseRoom);
    const res = await DELETE({} as Request, { params: PARAMS("u1") });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/disband/i);
  });

  it("returns 404 when target is not a member", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    mockDb.room.findUnique.mockResolvedValue(baseRoom);
    const res = await DELETE({} as Request, { params: PARAMS("u999") });
    expect(res.status).toBe(404);
  });

  it("allows member to leave their own group", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u2", name: "Bob" } } as never);
    mockDb.room.findUnique.mockResolvedValue(baseRoom);
    const res = await DELETE({} as Request, { params: PARAMS("u2") });
    expect(res.status).toBe(200);
    expect(mockDb.roomMember.delete).toHaveBeenCalledWith({
      where: { userId_roomId: { userId: "u2", roomId: "r1" } },
    });
  });

  it("allows creator to remove another member", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", name: "Creator" } } as never);
    mockDb.room.findUnique.mockResolvedValue(baseRoom);
    const res = await DELETE({} as Request, { params: PARAMS("u2") });
    expect(res.status).toBe(200);
    expect(mockDb.roomMember.delete).toHaveBeenCalled();
  });

  it("cascades predictions and side bet data on removal", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    mockDb.room.findUnique.mockResolvedValue(baseRoom);
    await DELETE({} as Request, { params: PARAMS("u2") });
    expect(mockDb.prediction.deleteMany).toHaveBeenCalledWith({ where: { userId: "u2", roomId: "r1" } });
    expect(mockDb.groupStandingPrediction.deleteMany).toHaveBeenCalledWith({ where: { userId: "u2", roomId: "r1" } });
    expect(mockDb.sideBetEntry.deleteMany).toHaveBeenCalled();
    expect(mockDb.p2PSideBet.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ proposerId: "u2", status: { not: "settled" } }) }),
    );
    expect(mockDb.p2PSideBet.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ acceptorId: "u2", status: { not: "settled" } }) }),
    );
  });
});

describe("PATCH /api/groups/[roomId]/members/[targetUserId]", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null as any);
    const res = await PATCH(patchRequest({ paid: true }), { params: PARAMS() });
    expect(res.status).toBe(401);
  });

  it("returns 404 when room not found", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", role: "user" } } as never);
    mockDb.room.findUnique.mockResolvedValue(null);
    const res = await PATCH(patchRequest({ paid: true }), { params: PARAMS() });
    expect(res.status).toBe(404);
  });

  it("returns 403 when non-creator non-admin tries to toggle paid", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u2", role: "user" } } as never);
    mockDb.room.findUnique.mockResolvedValue({ creatorId: "u1" });
    const res = await PATCH(patchRequest({ paid: true }), { params: PARAMS() });
    expect(res.status).toBe(403);
  });

  it("returns 400 when paid is not a boolean", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", role: "user" } } as never);
    mockDb.room.findUnique.mockResolvedValue({ creatorId: "u1" });
    const res = await PATCH(patchRequest({ paid: "yes" }), { params: PARAMS() });
    expect(res.status).toBe(400);
  });

  it("updates paid status and returns updated member", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", role: "user" } } as never);
    mockDb.room.findUnique.mockResolvedValue({ creatorId: "u1" });
    mockDb.roomMember.update.mockResolvedValue({ userId: "u2", paid: true });
    const res = await PATCH(patchRequest({ paid: true }), { params: PARAMS() });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.paid).toBe(true);
    expect(mockDb.roomMember.update).toHaveBeenCalledWith({
      where: { userId_roomId: { userId: "u2", roomId: "r1" } },
      data: { paid: true },
    });
  });

  it("platform admin can also toggle paid", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u99", role: "admin" } } as never);
    mockDb.room.findUnique.mockResolvedValue({ creatorId: "u1" });
    mockDb.roomMember.update.mockResolvedValue({ userId: "u2", paid: false });
    const res = await PATCH(patchRequest({ paid: false }), { params: PARAMS() });
    expect(res.status).toBe(200);
  });
});
