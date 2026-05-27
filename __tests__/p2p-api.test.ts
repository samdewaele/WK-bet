import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    roomMember: {
      findUnique: vi.fn(),
    },
    p2PSideBet: {
      findMany: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { auth } from "@auth";
import { db } from "@/lib/db";
import { GET, POST, PATCH } from "@/app/api/groups/[roomId]/p2p/route";

const mockAuth = vi.mocked(auth);
const mockDb = db as any;

const PARAMS = Promise.resolve({ roomId: "room1" });

function makePostRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/groups/room1/p2p", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makePatchRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/groups/room1/p2p", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const mockBet = {
  id: "bet1",
  roomId: "room1",
  proposerId: "u1",
  acceptorId: null,
  amount: 10,
  description: "Test bet",
  status: "proposed",
  winner: null,
  createdAt: new Date("2025-06-01T12:00:00Z"),
  proposer: { id: "u1", name: "Alice", image: null },
  acceptor: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/groups/[roomId]/p2p", () => {
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

  it("returns only bets involving the current user", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    mockDb.roomMember.findUnique.mockResolvedValue({ id: "rm1" } as never);
    mockDb.p2PSideBet.findMany.mockResolvedValue([mockBet] as never);

    const res = await GET({} as never, { params: PARAMS });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveLength(1);
    expect(json[0].id).toBe("bet1");
    expect(mockDb.p2PSideBet.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { proposerId: "u1" },
            { acceptorId: "u1" },
          ]),
        }),
      })
    );
  });
});

describe("POST /api/groups/[roomId]/p2p — propose", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null as any);
    const res = await POST(makePostRequest({}), { params: PARAMS });
    expect(res.status).toBe(401);
  });

  it("returns 403 when not a member", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    mockDb.roomMember.findUnique.mockResolvedValue(null);
    const res = await POST(makePostRequest({ amount: 10, description: "bet" }), { params: PARAMS });
    expect(res.status).toBe(403);
  });

  it("returns 400 when amount is missing", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    mockDb.roomMember.findUnique.mockResolvedValue({ id: "rm1" } as never);
    const res = await POST(makePostRequest({ description: "bet" }), { params: PARAMS });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/amount/i);
  });

  it("returns 400 when amount is zero or negative", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    mockDb.roomMember.findUnique.mockResolvedValue({ id: "rm1" } as never);
    const res = await POST(makePostRequest({ amount: 0, description: "bet" }), { params: PARAMS });
    expect(res.status).toBe(400);
  });

  it("returns 400 when description is missing", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    mockDb.roomMember.findUnique.mockResolvedValue({ id: "rm1" } as never);
    const res = await POST(makePostRequest({ amount: 10 }), { params: PARAMS });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/description/i);
  });

  it("returns 400 when betting against yourself", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    mockDb.roomMember.findUnique.mockResolvedValue({ id: "rm1" } as never);
    const res = await POST(
      makePostRequest({ amount: 10, description: "bet", targetUserId: "u1" }),
      { params: PARAMS }
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/yourself/i);
  });

  it("returns 404 when target user is not a member", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    mockDb.roomMember.findUnique
      .mockResolvedValueOnce({ id: "rm1" } as never)
      .mockResolvedValueOnce(null);
    const res = await POST(
      makePostRequest({ amount: 10, description: "bet", targetUserId: "u99" }),
      { params: PARAMS }
    );
    expect(res.status).toBe(404);
  });

  it("creates a new P2P bet", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    mockDb.roomMember.findUnique.mockResolvedValue({ id: "rm1" } as never);
    mockDb.p2PSideBet.create.mockResolvedValue({
      ...mockBet,
      createdAt: new Date("2025-06-01T12:00:00Z"),
    } as never);

    const res = await POST(
      makePostRequest({ amount: 10, description: "Test bet" }),
      { params: PARAMS }
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe("bet1");
    expect(json.amount).toBe(10);
    expect(json.status).toBe("proposed");
  });
});

describe("PATCH /api/groups/[roomId]/p2p — accept/decline/settle", () => {
  it("returns 400 when betId or action is missing", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u2" } } as never);
    mockDb.roomMember.findUnique.mockResolvedValue({ id: "rm2" } as never);
    const res = await PATCH(makePatchRequest({ betId: "bet1" }), { params: PARAMS });
    expect(res.status).toBe(400);
  });

  it("returns 404 when bet not found", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u2" } } as never);
    mockDb.roomMember.findUnique.mockResolvedValue({ id: "rm2" } as never);
    mockDb.p2PSideBet.findFirst.mockResolvedValue(null);
    const res = await PATCH(
      makePatchRequest({ betId: "bad", action: "accept" }),
      { params: PARAMS }
    );
    expect(res.status).toBe(404);
  });

  it("accepts a proposed bet", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u2" } } as never);
    mockDb.roomMember.findUnique.mockResolvedValue({ id: "rm2" } as never);
    mockDb.p2PSideBet.findFirst.mockResolvedValue({ ...mockBet, status: "proposed" } as never);
    mockDb.p2PSideBet.update.mockResolvedValue({ id: "bet1", status: "accepted" } as never);

    const res = await PATCH(
      makePatchRequest({ betId: "bet1", action: "accept" }),
      { params: PARAMS }
    );
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("accepted");
    expect(mockDb.p2PSideBet.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "accepted", acceptorId: "u2" }),
      })
    );
  });

  it("returns 400 when proposer tries to accept their own bet", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    mockDb.roomMember.findUnique.mockResolvedValue({ id: "rm1" } as never);
    mockDb.p2PSideBet.findFirst.mockResolvedValue({ ...mockBet, proposerId: "u1" } as never);

    const res = await PATCH(
      makePatchRequest({ betId: "bet1", action: "accept" }),
      { params: PARAMS }
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/own bet/i);
  });

  it("declines a proposed bet", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u2" } } as never);
    mockDb.roomMember.findUnique.mockResolvedValue({ id: "rm2" } as never);
    mockDb.p2PSideBet.findFirst.mockResolvedValue({
      ...mockBet,
      acceptorId: "u2",
    } as never);
    mockDb.p2PSideBet.update.mockResolvedValue({ id: "bet1", status: "declined" } as never);

    const res = await PATCH(
      makePatchRequest({ betId: "bet1", action: "decline" }),
      { params: PARAMS }
    );
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("declined");
  });

  it("returns 400 when declining a non-proposed bet", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    mockDb.roomMember.findUnique.mockResolvedValue({ id: "rm1" } as never);
    mockDb.p2PSideBet.findFirst.mockResolvedValue({
      ...mockBet,
      status: "accepted",
    } as never);

    const res = await PATCH(
      makePatchRequest({ betId: "bet1", action: "decline" }),
      { params: PARAMS }
    );
    expect(res.status).toBe(400);
  });

  it("settles a bet with proposer as winner", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    mockDb.roomMember.findUnique.mockResolvedValue({ id: "rm1" } as never);
    mockDb.p2PSideBet.findFirst.mockResolvedValue({
      ...mockBet,
      status: "accepted",
      acceptorId: "u2",
    } as never);
    mockDb.p2PSideBet.update.mockResolvedValue({
      id: "bet1",
      status: "settled",
      winner: "proposer",
    } as never);

    const res = await PATCH(
      makePatchRequest({ betId: "bet1", action: "settle", winner: "proposer" }),
      { params: PARAMS }
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("settled");
    expect(json.winner).toBe("proposer");
  });

  it("settles a bet with acceptor as winner", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    mockDb.roomMember.findUnique.mockResolvedValue({ id: "rm1" } as never);
    mockDb.p2PSideBet.findFirst.mockResolvedValue({
      ...mockBet,
      status: "accepted",
      acceptorId: "u2",
    } as never);
    mockDb.p2PSideBet.update.mockResolvedValue({
      id: "bet1",
      status: "settled",
      winner: "acceptor",
    } as never);

    const res = await PATCH(
      makePatchRequest({ betId: "bet1", action: "settle", winner: "acceptor" }),
      { params: PARAMS }
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.winner).toBe("acceptor");
  });

  it("returns 400 when settling with invalid winner value", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    mockDb.roomMember.findUnique.mockResolvedValue({ id: "rm1" } as never);
    mockDb.p2PSideBet.findFirst.mockResolvedValue({
      ...mockBet,
      status: "accepted",
      proposerId: "u1",
    } as never);

    const res = await PATCH(
      makePatchRequest({ betId: "bet1", action: "settle", winner: "invalid" }),
      { params: PARAMS }
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/proposer.*acceptor/i);
  });

  it("returns 400 when settling a non-accepted bet", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    mockDb.roomMember.findUnique.mockResolvedValue({ id: "rm1" } as never);
    mockDb.p2PSideBet.findFirst.mockResolvedValue({
      ...mockBet,
      status: "proposed",
      proposerId: "u1",
    } as never);

    const res = await PATCH(
      makePatchRequest({ betId: "bet1", action: "settle", winner: "proposer" }),
      { params: PARAMS }
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for unknown action", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    mockDb.roomMember.findUnique.mockResolvedValue({ id: "rm1" } as never);
    mockDb.p2PSideBet.findFirst.mockResolvedValue({ ...mockBet } as never);

    const res = await PATCH(
      makePatchRequest({ betId: "bet1", action: "unknown" }),
      { params: PARAMS }
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/invalid action/i);
  });
});
