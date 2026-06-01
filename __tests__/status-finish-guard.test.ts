import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/tournament-lock", () => ({ isTournamentStarted: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ buildRoomLeaderboard: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/email", () => ({
  emailBettingOpen: vi.fn().mockResolvedValue(undefined),
  emailUberPotLocked: vi.fn().mockResolvedValue(undefined),
  emailGroupStageStarted: vi.fn().mockResolvedValue(undefined),
  emailGroupStageComplete: vi.fn().mockResolvedValue(undefined),
  emailKOStageActive: vi.fn().mockResolvedValue(undefined),
  emailSettlingStarted: vi.fn().mockResolvedValue(undefined),
  emailTournamentFinished: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/db", () => ({
  db: {
    room: { findUnique: vi.fn(), update: vi.fn() },
    roomMember: { findUnique: vi.fn() },
    sideBet: { count: vi.fn() },
  },
}));

import { auth } from "@auth";
import { db } from "@/lib/db";
import { PATCH } from "@/app/api/admin/groups/[roomId]/route";

const mockAuth = vi.mocked(auth);
const mockDb = db as any;
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
  mockAuth.mockResolvedValue({ user: { id: "u1", role: "user" } } as never);
  // creator access + background member lookup
  mockDb.room.findUnique.mockResolvedValue({ creatorId: "u1", name: "G", entryFee: 0, members: [] });
  mockDb.room.update.mockResolvedValue({ id: "r1", name: "G", entryFee: 0, status: "x", simulationMode: false });
  mockDb.sideBet.count.mockResolvedValue(0);
});

describe("settling status", () => {
  it("accepts a transition to settling", async () => {
    const res = await PATCH(patchRequest({ status: "settling" }), { params: PARAMS });
    expect(res.status).toBe(200);
    expect(mockDb.room.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "settling" } }),
    );
  });
});

describe("finish guard", () => {
  it("blocks finishing while open Uber Pot bets remain", async () => {
    mockDb.sideBet.count.mockResolvedValue(2);
    const res = await PATCH(patchRequest({ status: "finished" }), { params: PARAMS });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/settle/i);
    expect(mockDb.room.update).not.toHaveBeenCalled();
  });

  it("allows finishing when every Uber Pot bet is settled", async () => {
    mockDb.sideBet.count.mockResolvedValue(0);
    const res = await PATCH(patchRequest({ status: "finished" }), { params: PARAMS });
    expect(res.status).toBe(200);
    expect(mockDb.room.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "finished" } }),
    );
    // count was scoped to this room's open bets
    expect(mockDb.sideBet.count).toHaveBeenCalledWith({ where: { roomId: "r1", status: "open" } });
  });
});
