import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/tournament-lock", () => ({ isTournamentStarted: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    room: { findUnique: vi.fn() },
    roomMember: { findUnique: vi.fn() },
    sideBet: { create: vi.fn(), findFirst: vi.fn() },
    sideBetEntry: { upsert: vi.fn() },
  },
}));

import { auth } from "@auth";
import { db } from "@/lib/db";
import { isTournamentStarted } from "@/lib/tournament-lock";
import { POST as createBet } from "@/app/api/groups/[roomId]/sidebets/route";
import { POST as submitAnswer } from "@/app/api/groups/[roomId]/sidebets/[sideBetId]/entries/route";

const mockAuth = vi.mocked(auth);
const mockDb = db as any;
const mockStarted = vi.mocked(isTournamentStarted);

function req(body: unknown): NextRequest {
  return new NextRequest("http://localhost", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "u1", role: "user" } } as never);
  mockStarted.mockResolvedValue(false);
  mockDb.roomMember.findUnique.mockResolvedValue({ userId: "u1", roomId: "r1" });
  mockDb.sideBet.create.mockResolvedValue({ id: "sb1", title: "T", description: null, status: "open", winnerEntryId: null, createdAt: new Date(), proposedByUserId: "u1", proposedBy: { name: "A" } });
  mockDb.sideBetEntry.upsert.mockResolvedValue({ id: "e1", sideBetId: "sb1", userId: "u1", answer: "x" });
  mockDb.sideBet.findFirst.mockResolvedValue({ id: "sb1", status: "open" });
});

const BET_PARAMS = { params: Promise.resolve({ roomId: "r1" }) };
const ENTRY_PARAMS = { params: Promise.resolve({ roomId: "r1", sideBetId: "sb1" }) };

describe("Uber Pot proposal — closed locks betting", () => {
  it("rejects a new proposal once the room is closed", async () => {
    mockDb.room.findUnique.mockResolvedValue({ creatorId: "u1", uberBetsLocked: false, status: "closed" });
    const res = await createBet(req({ title: "Most goals?" }), BET_PARAMS);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/closed/i);
    expect(mockDb.sideBet.create).not.toHaveBeenCalled();
  });

  it("rejects a new proposal during group_active", async () => {
    mockDb.room.findUnique.mockResolvedValue({ creatorId: "u1", uberBetsLocked: false, status: "group_active" });
    const res = await createBet(req({ title: "X" }), BET_PARAMS);
    expect(res.status).toBe(403);
  });

  it("allows a proposal while still in betting", async () => {
    mockDb.room.findUnique.mockResolvedValue({ creatorId: "u1", uberBetsLocked: false, status: "betting" });
    const res = await createBet(req({ title: "Most goals?" }), BET_PARAMS);
    expect(res.status).toBe(200);
    expect(mockDb.sideBet.create).toHaveBeenCalled();
  });
});

describe("Uber Pot answer — closed locks betting", () => {
  it("rejects answer submission once the room is closed", async () => {
    mockDb.room.findUnique.mockResolvedValue({ status: "closed" });
    const res = await submitAnswer(req({ answer: "Messi" }), ENTRY_PARAMS);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/closed/i);
    expect(mockDb.sideBetEntry.upsert).not.toHaveBeenCalled();
  });

  it("allows answer submission while still in betting", async () => {
    mockDb.room.findUnique.mockResolvedValue({ status: "betting" });
    const res = await submitAnswer(req({ answer: "Messi" }), ENTRY_PARAMS);
    expect(res.status).toBe(200);
    expect(mockDb.sideBetEntry.upsert).toHaveBeenCalled();
  });
});
