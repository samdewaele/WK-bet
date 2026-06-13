import { it, expect, vi, beforeEach } from "vitest";

vi.mock("@auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/tournament-lock", () => ({ isTournamentStarted: vi.fn() }));
vi.mock("@/lib/uber-pot", () => ({ computeUberPotResults: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    room: { findUnique: vi.fn() },
    roomMember: { findUnique: vi.fn() },
    sideBet: { findMany: vi.fn() },
  },
}));

import { auth } from "@auth";
import { db } from "@/lib/db";
import { isTournamentStarted } from "@/lib/tournament-lock";
import { computeUberPotResults } from "@/lib/uber-pot";
import { GET } from "@/app/api/groups/[roomId]/sidebets/route";

const mockAuth = vi.mocked(auth);
const mockDb = db as any;
const mockStarted = vi.mocked(isTournamentStarted);
const mockUber = vi.mocked(computeUberPotResults);
const PARAMS = { params: Promise.resolve({ roomId: "r1" }) };
const call = () => GET(new Request("http://localhost"), PARAMS);

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "u1", role: "user" } } as never);
  mockStarted.mockResolvedValue(true);
  mockDb.roomMember.findUnique.mockResolvedValue({ id: "rm1" });
  mockDb.room.findUnique.mockResolvedValue({ creatorId: "u1" });
  mockUber.mockResolvedValue({
    uberPot: 40, prizePerSettledBet: 40, settledCount: 1,
    byBet: new Map([["b1", { winnerEntryId: "e1", winnerUserId: "u1", prize: 40 }]]),
    byUser: new Map([["u1", 40]]),
  });
});

it("returns the prize amount on a settled bet", async () => {
  mockDb.sideBet.findMany.mockResolvedValue([
    {
      id: "b1", title: "Top scorer?", description: null, status: "settled", winnerEntryId: "e1",
      createdAt: new Date(), proposedByUserId: "u1", proposedBy: { id: "u1", name: "Alice" },
      entries: [{ id: "e1", userId: "u1", answer: "Mbappé", user: { id: "u1", name: "Alice", image: null } }],
    },
  ]);
  const body = await (await call()).json();
  expect(body[0].prize).toBe(40);
});

it("leaves prize null while the bet is still open", async () => {
  mockDb.sideBet.findMany.mockResolvedValue([
    {
      id: "b2", title: "Open one", description: null, status: "open", winnerEntryId: null,
      createdAt: new Date(), proposedByUserId: "u1", proposedBy: { id: "u1", name: "Alice" },
      entries: [{ id: "e2", userId: "u1", answer: "Kane", user: { id: "u1", name: "Alice", image: null } }],
    },
  ]);
  const body = await (await call()).json();
  expect(body[0].prize).toBeNull();
});
