import { it, expect, vi, beforeEach } from "vitest";

vi.mock("@auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/uber-pot", () => ({ computeUberPotResults: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    roomMember: { findUnique: vi.fn(), findMany: vi.fn() },
    room: { findUnique: vi.fn() },
    match: { findMany: vi.fn() },
    groupStandingPrediction: { findMany: vi.fn() },
    kOPrediction: { findMany: vi.fn() },
    sideBet: { findMany: vi.fn() },
    team: { findMany: vi.fn() },
  },
}));

import { auth } from "@auth";
import { db } from "@/lib/db";
import { computeUberPotResults } from "@/lib/uber-pot";
import { GET } from "@/app/api/groups/[roomId]/predictions-overview/route";

const mockAuth = vi.mocked(auth);
const mockDb = db as any;
const mockUber = vi.mocked(computeUberPotResults);
const PARAMS = Promise.resolve({ roomId: "r1" });
const call = () => GET(new Request("http://localhost"), { params: PARAMS });

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
  mockDb.roomMember.findUnique.mockResolvedValue({ userId: "u1", roomId: "r1" });
  // No kickoffs by default → groups only revealed via room status
  mockDb.match.findMany.mockResolvedValue([]);
  mockDb.roomMember.findMany.mockResolvedValue([
    { userId: "u1", user: { id: "u1", name: "Alice", image: null } },
  ]);
  mockDb.groupStandingPrediction.findMany.mockResolvedValue([
    { userId: "u1", wcGroup: "A", position1: "t1", position2: "t2", position3: "t3", position4: "t4", earnedAmount: 30 },
  ]);
  mockDb.kOPrediction.findMany.mockResolvedValue([]);
  mockDb.sideBet.findMany.mockResolvedValue([]);
  mockDb.team.findMany.mockResolvedValue([
    { id: "t1", name: "Mexico", flag: "🇲🇽" },
    { id: "t2", name: "Canada", flag: "🇨🇦" },
    { id: "t3", name: "USA", flag: "🇺🇸" },
    { id: "t4", name: "Qatar", flag: "🇶🇦" },
  ]);
  mockUber.mockResolvedValue({
    uberPot: 0, prizePerSettledBet: 0, settledCount: 0, byBet: new Map(), byUser: new Map(),
  });
});

it("returns 403 when not a member", async () => {
  mockDb.roomMember.findUnique.mockResolvedValue(null);
  mockDb.room.findUnique.mockResolvedValue({ status: "group_active" });
  expect((await call()).status).toBe(403);
});

it("is locked (403) during setup / betting / closed", async () => {
  for (const status of ["setup", "betting", "closed"]) {
    mockDb.room.findUnique.mockResolvedValue({ status });
    expect((await call()).status).toBe(403);
  }
});

it("reveals group standings + earned money but NOT KO during group_active", async () => {
  mockDb.room.findUnique.mockResolvedValue({ status: "group_active" });
  const res = await call();
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.revealKO).toBe(false);
  expect(body.members[0].standings[0].wcGroup).toBe("A");
  expect(body.members[0].standings[0].positions[0].name).toBe("Mexico");
  expect(body.members[0].standings[0].earnedAmount).toBe(30);
  expect(body.members[0].knockout).toBeNull();
  expect(mockDb.kOPrediction.findMany).not.toHaveBeenCalled();
});

it("reveals KO predictions + earned money from ko_active onwards", async () => {
  mockDb.room.findUnique.mockResolvedValue({ status: "ko_active" });
  mockDb.kOPrediction.findMany.mockResolvedValue([
    {
      userId: "u1", matchId: "m1", homeScore: 2, awayScore: 1, earnedAmount: 80,
      match: {
        round: "R32", matchNumber: 73, kickoff: new Date(), status: "finished",
        homeScore: 2, awayScore: 1,
        homeTeam: { id: "t1", name: "Mexico", flag: "🇲🇽" },
        awayTeam: { id: "t2", name: "Canada", flag: "🇨🇦" },
      },
    },
  ]);
  const res = await call();
  const body = await res.json();
  expect(body.revealKO).toBe(true);
  expect(body.members[0].knockout).toHaveLength(1);
  expect(body.members[0].knockout[0].round).toBe("R32");
  expect(body.members[0].knockout[0].earnedAmount).toBe(80);
});

it("includes Uber Pot bets with winner + prize once settled", async () => {
  mockDb.room.findUnique.mockResolvedValue({ status: "ko_active" });
  mockDb.sideBet.findMany.mockResolvedValue([
    {
      id: "b1", title: "Top scorer?", description: null, status: "settled", winnerEntryId: "e1",
      entries: [
        { id: "e1", userId: "u1", answer: "Mbappé", user: { id: "u1", name: "Alice" } },
        { id: "e2", userId: "u2", answer: "Kane", user: { id: "u2", name: "Bob" } },
      ],
    },
    {
      id: "b2", title: "Proposed one", description: null, status: "proposed", winnerEntryId: null, entries: [],
    },
  ]);
  mockUber.mockResolvedValue({
    uberPot: 40, prizePerSettledBet: 40, settledCount: 1,
    byBet: new Map([["b1", { winnerEntryId: "e1", winnerUserId: "u1", prize: 40 }]]),
    byUser: new Map([["u1", 40]]),
  });

  const res = await call();
  const body = await res.json();
  // proposed bets are excluded from the shared view
  expect(body.uberPot.bets).toHaveLength(1);
  const bet = body.uberPot.bets[0];
  expect(bet.id).toBe("b1");
  expect(bet.status).toBe("settled");
  expect(bet.winnerUserId).toBe("u1");
  expect(bet.prize).toBe(40);
  expect(bet.entries).toHaveLength(2);
  expect(bet.entries[0].answer).toBe("Mbappé");
});

it("shows Uber Pot answers but no prize while a bet is still open", async () => {
  mockDb.room.findUnique.mockResolvedValue({ status: "group_active" });
  mockDb.sideBet.findMany.mockResolvedValue([
    {
      id: "b1", title: "Top scorer?", description: null, status: "open", winnerEntryId: null,
      entries: [{ id: "e1", userId: "u1", answer: "Mbappé", user: { id: "u1", name: "Alice" } }],
    },
  ]);
  const res = await call();
  const body = await res.json();
  expect(body.uberPot.bets[0].prize).toBeNull();
  expect(body.uberPot.bets[0].winnerUserId).toBeNull();
  expect(body.uberPot.bets[0].entries[0].answer).toBe("Mbappé");
});
