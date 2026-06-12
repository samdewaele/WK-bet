/**
 * Tests for PATCH /api/groups/[roomId]/sidebets
 * Covers: accept, reject, cancel, settle, and edit actions.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/tournament-lock", () => ({ isTournamentStarted: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    room: { findUnique: vi.fn() },
    sideBet: { findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
    sideBetEntry: { findUnique: vi.fn(), deleteMany: vi.fn() },
  },
}));

import { auth } from "@auth";
import { db } from "@/lib/db";
import { isTournamentStarted } from "@/lib/tournament-lock";
import { PATCH } from "@/app/api/groups/[roomId]/sidebets/route";

const mockAuth = vi.mocked(auth);
const mockDb = db as any;
const mockStarted = vi.mocked(isTournamentStarted);

const PARAMS = { params: Promise.resolve({ roomId: "r1" }) };

function req(body: unknown): NextRequest {
  return new NextRequest("http://localhost", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** A typical open side bet proposed by user u1. */
const openBet = {
  id: "sb1",
  roomId: "r1",
  title: "Top scorer?",
  description: "Who scores the most?",
  status: "open",
  winnerEntryId: null,
  proposedByUserId: "u1",
};

const settledBet = { ...openBet, status: "settled", winnerEntryId: "e1" };
const proposedBet = { ...openBet, status: "proposed" };

beforeEach(() => {
  vi.clearAllMocks();
  // Default: authenticated as manager (u1 is creator)
  mockAuth.mockResolvedValue({ user: { id: "u1", role: "user" } } as never);
  mockStarted.mockResolvedValue(false);
  mockDb.room.findUnique.mockResolvedValue({ creatorId: "u1" });
  mockDb.sideBet.findFirst.mockResolvedValue(openBet);
  mockDb.sideBet.update.mockResolvedValue({ ...openBet });
  mockDb.sideBet.delete.mockResolvedValue({});
  mockDb.sideBetEntry.deleteMany.mockResolvedValue({});
  mockDb.sideBetEntry.findUnique.mockResolvedValue({ id: "e1", sideBetId: "sb1" });
});

// ── Auth / not-found guards ──────────────────────────────────────────────────

it("returns 401 when not authenticated", async () => {
  mockAuth.mockResolvedValue(null as never);
  const res = await PATCH(req({ sideBetId: "sb1", action: "edit", title: "X" }), PARAMS);
  expect(res.status).toBe(401);
});

it("returns 404 when room not found", async () => {
  mockDb.room.findUnique.mockResolvedValue(null);
  const res = await PATCH(req({ sideBetId: "sb1", action: "edit", title: "X" }), PARAMS);
  expect(res.status).toBe(404);
});

it("returns 400 when sideBetId is missing", async () => {
  const res = await PATCH(req({ action: "edit", title: "X" }), PARAMS);
  expect(res.status).toBe(400);
});

it("returns 404 when the bet does not exist in the room", async () => {
  mockDb.sideBet.findFirst.mockResolvedValue(null);
  const res = await PATCH(req({ sideBetId: "sb1", action: "edit", title: "X" }), PARAMS);
  expect(res.status).toBe(404);
});

// ── accept ────────────────────────────────────────────────────────────────────

describe("accept", () => {
  beforeEach(() => {
    mockDb.sideBet.findFirst.mockResolvedValue(proposedBet);
    mockDb.sideBet.update.mockResolvedValue({ id: "sb1", status: "open" });
  });

  it("manager can accept a proposed bet", async () => {
    const res = await PATCH(req({ sideBetId: "sb1", action: "accept" }), PARAMS);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "open" });
    expect(mockDb.sideBet.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "open" } })
    );
  });

  it("non-manager cannot accept a proposed bet", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u2", role: "user" } } as never);
    mockDb.room.findUnique.mockResolvedValue({ creatorId: "u1" }); // u2 is not creator
    const res = await PATCH(req({ sideBetId: "sb1", action: "accept" }), PARAMS);
    expect(res.status).toBe(403);
  });

  it("cannot accept a bet that is already open", async () => {
    mockDb.sideBet.findFirst.mockResolvedValue(openBet);
    const res = await PATCH(req({ sideBetId: "sb1", action: "accept" }), PARAMS);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/not a proposal/i);
  });
});

// ── reject ────────────────────────────────────────────────────────────────────

describe("reject", () => {
  it("manager can reject a proposed bet (deletes bet and entries)", async () => {
    mockDb.sideBet.findFirst.mockResolvedValue(proposedBet);
    const res = await PATCH(req({ sideBetId: "sb1", action: "reject" }), PARAMS);
    expect(res.status).toBe(200);
    expect(mockDb.sideBetEntry.deleteMany).toHaveBeenCalled();
    expect(mockDb.sideBet.delete).toHaveBeenCalled();
  });

  it("non-manager cannot reject", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u2", role: "user" } } as never);
    mockDb.room.findUnique.mockResolvedValue({ creatorId: "u1" });
    const res = await PATCH(req({ sideBetId: "sb1", action: "reject" }), PARAMS);
    expect(res.status).toBe(403);
  });
});

// ── cancel ────────────────────────────────────────────────────────────────────

describe("cancel", () => {
  it("proposer can cancel their own open bet", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", role: "user" } } as never);
    const res = await PATCH(req({ sideBetId: "sb1", action: "cancel" }), PARAMS);
    expect(res.status).toBe(200);
    expect(mockDb.sideBet.delete).toHaveBeenCalled();
  });

  it("manager can cancel any open bet", async () => {
    // u2 is the proposer, u1 is the manager
    mockDb.sideBet.findFirst.mockResolvedValue({ ...openBet, proposedByUserId: "u2" });
    const res = await PATCH(req({ sideBetId: "sb1", action: "cancel" }), PARAMS);
    expect(res.status).toBe(200);
  });

  it("non-proposer non-manager cannot cancel", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u3", role: "user" } } as never);
    mockDb.room.findUnique.mockResolvedValue({ creatorId: "u1" }); // u3 is neither creator nor proposer
    const res = await PATCH(req({ sideBetId: "sb1", action: "cancel" }), PARAMS);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/your own/i);
  });

  it("cannot cancel a settled bet", async () => {
    mockDb.sideBet.findFirst.mockResolvedValue(settledBet);
    const res = await PATCH(req({ sideBetId: "sb1", action: "cancel" }), PARAMS);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/settled/i);
  });

  it("cannot cancel when tournament started", async () => {
    mockStarted.mockResolvedValue(true);
    mockDb.room.findUnique.mockResolvedValueOnce({ creatorId: "u1" }) // resolveRoom
                          .mockResolvedValueOnce({ uberBetsLocked: false }); // cancel lock check
    const res = await PATCH(req({ sideBetId: "sb1", action: "cancel" }), PARAMS);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/locked/i);
  });
});

// ── edit ─────────────────────────────────────────────────────────────────────

describe("edit", () => {
  beforeEach(() => {
    mockDb.sideBet.update.mockResolvedValue({
      id: "sb1",
      title: "Updated title",
      description: "Updated desc",
    });
  });

  it("proposer can edit title and description of their own open bet", async () => {
    const res = await PATCH(
      req({ sideBetId: "sb1", action: "edit", title: "Updated title", description: "Updated desc" }),
      PARAMS
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe("Updated title");
    expect(body.description).toBe("Updated desc");
    expect(mockDb.sideBet.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sb1" },
        data: expect.objectContaining({ title: "Updated title" }),
      })
    );
  });

  it("manager can edit any non-settled bet regardless of who proposed it", async () => {
    mockDb.sideBet.findFirst.mockResolvedValue({ ...openBet, proposedByUserId: "u2" });
    const res = await PATCH(
      req({ sideBetId: "sb1", action: "edit", title: "Manager edit" }),
      PARAMS
    );
    expect(res.status).toBe(200);
    expect(mockDb.sideBet.update).toHaveBeenCalled();
  });

  it("non-proposer non-manager cannot edit", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u3", role: "user" } } as never);
    mockDb.room.findUnique.mockResolvedValue({ creatorId: "u1" });
    mockDb.sideBet.findFirst.mockResolvedValue({ ...openBet, proposedByUserId: "u2" });
    const res = await PATCH(
      req({ sideBetId: "sb1", action: "edit", title: "Sneaky edit" }),
      PARAMS
    );
    expect(res.status).toBe(403);
  });

  it("cannot edit a settled bet", async () => {
    mockDb.sideBet.findFirst.mockResolvedValue(settledBet);
    const res = await PATCH(
      req({ sideBetId: "sb1", action: "edit", title: "New title" }),
      PARAMS
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/settled/i);
  });

  it("rejects an empty title string", async () => {
    const res = await PATCH(
      req({ sideBetId: "sb1", action: "edit", title: "   " }),
      PARAMS
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/empty/i);
  });

  it("can edit description only (title unchanged when not provided)", async () => {
    mockDb.sideBet.update.mockResolvedValue({
      id: "sb1",
      title: "Top scorer?",
      description: "New desc only",
    });
    const res = await PATCH(
      req({ sideBetId: "sb1", action: "edit", description: "New desc only" }),
      PARAMS
    );
    expect(res.status).toBe(200);
    // Title key should not be in the update data when not provided
    const updateCall = mockDb.sideBet.update.mock.calls[0][0];
    expect(updateCall.data.title).toBeUndefined();
    expect(updateCall.data.description).toBe("New desc only");
  });

  it("can clear description by passing empty string (stored as null)", async () => {
    mockDb.sideBet.update.mockResolvedValue({ id: "sb1", title: "Top scorer?", description: null });
    const res = await PATCH(
      req({ sideBetId: "sb1", action: "edit", description: "" }),
      PARAMS
    );
    expect(res.status).toBe(200);
    const updateCall = mockDb.sideBet.update.mock.calls[0][0];
    expect(updateCall.data.description).toBeNull();
  });

  it("can edit a proposed bet (not yet accepted)", async () => {
    mockDb.sideBet.findFirst.mockResolvedValue(proposedBet);
    const res = await PATCH(
      req({ sideBetId: "sb1", action: "edit", title: "Fixed title" }),
      PARAMS
    );
    expect(res.status).toBe(200);
    expect(mockDb.sideBet.update).toHaveBeenCalled();
  });

  it("platform admin can edit any bet even if not the proposer or creator", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin1", role: "admin" } } as never);
    mockDb.room.findUnique.mockResolvedValue({ creatorId: "u1" }); // admin1 is not creator but has role "admin"
    mockDb.sideBet.findFirst.mockResolvedValue({ ...openBet, proposedByUserId: "u2" });
    const res = await PATCH(
      req({ sideBetId: "sb1", action: "edit", title: "Admin override" }),
      PARAMS
    );
    expect(res.status).toBe(200);
  });
});

// ── settle (set winner) ───────────────────────────────────────────────────────

describe("settle (set winner)", () => {
  it("manager can settle an open bet by picking a winner entry", async () => {
    mockDb.sideBetEntry.findUnique.mockResolvedValue({ id: "e1", sideBetId: "sb1" });
    mockDb.sideBet.update.mockResolvedValue({ id: "sb1", status: "settled", winnerEntryId: "e1" });
    const res = await PATCH(req({ sideBetId: "sb1", winnerEntryId: "e1" }), PARAMS);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "settled", winnerEntryId: "e1" });
  });

  it("non-manager cannot settle", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u2", role: "user" } } as never);
    mockDb.room.findUnique.mockResolvedValue({ creatorId: "u1" });
    const res = await PATCH(req({ sideBetId: "sb1", winnerEntryId: "e1" }), PARAMS);
    expect(res.status).toBe(403);
  });

  it("cannot re-settle an already settled bet", async () => {
    mockDb.sideBet.findFirst.mockResolvedValue(settledBet);
    const res = await PATCH(req({ sideBetId: "sb1", winnerEntryId: "e2" }), PARAMS);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/already settled/i);
  });

  it("cannot settle a proposed bet before accepting it", async () => {
    mockDb.sideBet.findFirst.mockResolvedValue(proposedBet);
    const res = await PATCH(req({ sideBetId: "sb1", winnerEntryId: "e1" }), PARAMS);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/proposal/i);
  });

  it("returns 404 if winner entry does not belong to this bet", async () => {
    mockDb.sideBetEntry.findUnique.mockResolvedValue({ id: "e1", sideBetId: "other-bet" });
    const res = await PATCH(req({ sideBetId: "sb1", winnerEntryId: "e1" }), PARAMS);
    expect(res.status).toBe(404);
  });

  it("returns 404 if winner entry does not exist", async () => {
    mockDb.sideBetEntry.findUnique.mockResolvedValue(null);
    const res = await PATCH(req({ sideBetId: "sb1", winnerEntryId: "ghost" }), PARAMS);
    expect(res.status).toBe(404);
  });
});

// ── unknown action ────────────────────────────────────────────────────────────

it("returns 400 for an unrecognised action", async () => {
  const res = await PATCH(req({ sideBetId: "sb1", action: "fly-to-moon" }), PARAMS);
  expect(res.status).toBe(400);
});
