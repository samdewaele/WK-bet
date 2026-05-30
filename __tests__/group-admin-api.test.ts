import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/tournament-lock", () => ({ isTournamentStarted: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    room: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    roomMember: { findUnique: vi.fn(), deleteMany: vi.fn() },
    prediction: { deleteMany: vi.fn() },
    groupStandingPrediction: { deleteMany: vi.fn() },
    sideBet: { deleteMany: vi.fn() },
    sideBetEntry: { deleteMany: vi.fn() },
    p2PSideBet: { deleteMany: vi.fn() },
  },
}));

import { auth } from "@auth";
import { db } from "@/lib/db";
import { isTournamentStarted } from "@/lib/tournament-lock";
import { PATCH, DELETE } from "@/app/api/admin/groups/[roomId]/route";

const mockAuth = vi.mocked(auth);
const mockDb = db as any;
const mockTournamentStarted = vi.mocked(isTournamentStarted);

const PARAMS = Promise.resolve({ roomId: "r1" });

function patchRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTournamentStarted.mockResolvedValue(false);
  mockDb.prediction.deleteMany.mockResolvedValue({});
  mockDb.groupStandingPrediction.deleteMany.mockResolvedValue({});
  mockDb.sideBetEntry.deleteMany.mockResolvedValue({});
  mockDb.sideBet.deleteMany.mockResolvedValue({});
  mockDb.p2PSideBet.deleteMany.mockResolvedValue({});
  mockDb.roomMember.deleteMany.mockResolvedValue({});
  mockDb.room.delete.mockResolvedValue({});
});

describe("PATCH /api/admin/groups/[roomId]", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null as any);
    expect((await PATCH(patchRequest({ name: "X" }), { params: PARAMS })).status).toBe(401);
  });

  it("returns 403 when user is not creator or admin", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u2", role: "user" } } as never);
    mockDb.room.findUnique.mockResolvedValue({ creatorId: "u1" });
    expect((await PATCH(patchRequest({ name: "X" }), { params: PARAMS })).status).toBe(403);
  });

  it("returns 403 when room not found", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", role: "user" } } as never);
    mockDb.room.findUnique.mockResolvedValue(null);
    expect((await PATCH(patchRequest({ name: "X" }), { params: PARAMS })).status).toBe(403);
  });

  it("returns 400 when nothing to update", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", role: "user" } } as never);
    mockDb.room.findUnique.mockResolvedValue({ creatorId: "u1" });
    expect((await PATCH(patchRequest({}), { params: PARAMS })).status).toBe(400);
  });

  it("updates name and entryFee", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", role: "user" } } as never);
    mockDb.room.findUnique.mockResolvedValue({ creatorId: "u1" });
    mockDb.room.update.mockResolvedValue({ id: "r1", name: "New Name", entryFee: 20, status: "open" });
    const res = await PATCH(patchRequest({ name: "New Name", entryFee: 20 }), { params: PARAMS });
    expect(res.status).toBe(200);
    expect(mockDb.room.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: "New Name", entryFee: 20 } }),
    );
  });

  it("updates status", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", role: "user" } } as never);
    mockDb.room.findUnique.mockResolvedValue({ creatorId: "u1" });
    mockDb.room.update.mockResolvedValue({ id: "r1", name: "G", entryFee: 0, status: "closed", simulationMode: false });
    const res = await PATCH(patchRequest({ status: "closed" }), { params: PARAMS });
    expect(res.status).toBe(200);
    expect(mockDb.room.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "closed" } }),
    );
  });

  it("ignores invalid status value", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", role: "user" } } as never);
    mockDb.room.findUnique.mockResolvedValue({ creatorId: "u1" });
    const res = await PATCH(patchRequest({ status: "hackme" }), { params: PARAMS });
    expect(res.status).toBe(400);
  });

  it("transfers ownership when newCreatorId provided and target is a member", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", role: "user" } } as never);
    mockDb.room.findUnique.mockResolvedValue({ creatorId: "u1" });
    mockDb.roomMember.findUnique.mockResolvedValue({ userId: "u2" });
    mockDb.room.update.mockResolvedValue({ id: "r1", creatorId: "u2" });
    const res = await PATCH(patchRequest({ newCreatorId: "u2" }), { params: PARAMS });
    expect(res.status).toBe(200);
    expect((await res.json()).creatorId).toBe("u2");
  });

  it("returns 400 when transfer target is not a member", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", role: "user" } } as never);
    mockDb.room.findUnique.mockResolvedValue({ creatorId: "u1" });
    mockDb.roomMember.findUnique.mockResolvedValue(null);
    const res = await PATCH(patchRequest({ newCreatorId: "u99" }), { params: PARAMS });
    expect(res.status).toBe(400);
  });

  it("platform admin can update any group", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u99", role: "admin" } } as never);
    mockDb.room.findUnique.mockResolvedValue({ creatorId: "u1" });
    mockDb.room.update.mockResolvedValue({ id: "r1", name: "Admin edit", entryFee: 0, status: "open" });
    const res = await PATCH(patchRequest({ name: "Admin edit" }), { params: PARAMS });
    expect(res.status).toBe(200);
  });
});

describe("DELETE /api/admin/groups/[roomId]", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null as any);
    expect((await DELETE({} as Request, { params: PARAMS })).status).toBe(401);
  });

  it("returns 403 when not creator or admin", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u2", role: "user" } } as never);
    mockDb.room.findUnique.mockResolvedValue({ creatorId: "u1" });
    expect((await DELETE({} as Request, { params: PARAMS })).status).toBe(403);
  });

  it("returns 403 when tournament has started", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", role: "user" } } as never);
    mockDb.room.findUnique.mockResolvedValue({ creatorId: "u1" });
    mockTournamentStarted.mockResolvedValue(true);
    expect((await DELETE({} as Request, { params: PARAMS })).status).toBe(403);
  });

  it("disbands group and cascades all data", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", role: "user" } } as never);
    mockDb.room.findUnique.mockResolvedValue({ creatorId: "u1" });
    const res = await DELETE({} as Request, { params: PARAMS });
    expect(res.status).toBe(200);
    expect(mockDb.sideBetEntry.deleteMany).toHaveBeenCalled();
    expect(mockDb.sideBet.deleteMany).toHaveBeenCalled();
    expect(mockDb.p2PSideBet.deleteMany).toHaveBeenCalled();
    expect(mockDb.groupStandingPrediction.deleteMany).toHaveBeenCalled();
    expect(mockDb.prediction.deleteMany).toHaveBeenCalled();
    expect(mockDb.roomMember.deleteMany).toHaveBeenCalled();
    expect(mockDb.room.delete).toHaveBeenCalledWith({ where: { id: "r1" } });
  });
});
