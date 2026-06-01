import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    roomMember: { findUnique: vi.fn(), findMany: vi.fn() },
    room: { findUnique: vi.fn() },
    groupStandingPrediction: { findMany: vi.fn() },
    kOPrediction: { findMany: vi.fn() },
    team: { findMany: vi.fn() },
  },
}));

import { auth } from "@auth";
import { db } from "@/lib/db";
import { GET } from "@/app/api/groups/[roomId]/predictions-overview/route";

const mockAuth = vi.mocked(auth);
const mockDb = db as any;
const PARAMS = Promise.resolve({ roomId: "r1" });
const call = () => GET(new Request("http://localhost"), { params: PARAMS });

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
  mockDb.roomMember.findUnique.mockResolvedValue({ userId: "u1", roomId: "r1" });
  mockDb.roomMember.findMany.mockResolvedValue([
    { userId: "u1", user: { id: "u1", name: "Alice", image: null } },
  ]);
  mockDb.groupStandingPrediction.findMany.mockResolvedValue([
    { userId: "u1", wcGroup: "A", position1: "t1", position2: "t2", position3: "t3", position4: "t4", earnedAmount: null },
  ]);
  mockDb.kOPrediction.findMany.mockResolvedValue([]);
  mockDb.team.findMany.mockResolvedValue([
    { id: "t1", name: "Mexico", flag: "🇲🇽" },
    { id: "t2", name: "Canada", flag: "🇨🇦" },
    { id: "t3", name: "USA", flag: "🇺🇸" },
    { id: "t4", name: "Qatar", flag: "🇶🇦" },
  ]);
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

it("reveals group standings but NOT KO during group_active", async () => {
  mockDb.room.findUnique.mockResolvedValue({ status: "group_active" });
  const res = await call();
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.revealKO).toBe(false);
  expect(body.members[0].standings[0].wcGroup).toBe("A");
  expect(body.members[0].standings[0].positions[0].name).toBe("Mexico");
  expect(body.members[0].knockout).toBeNull();
  // KO predictions must not even be queried when hidden
  expect(mockDb.kOPrediction.findMany).not.toHaveBeenCalled();
});

it("reveals KO predictions from ko_active onwards", async () => {
  mockDb.room.findUnique.mockResolvedValue({ status: "ko_active" });
  mockDb.kOPrediction.findMany.mockResolvedValue([
    {
      userId: "u1", matchId: "m1", homeScore: 2, awayScore: 1, earnedAmount: null,
      match: {
        round: "R32", matchNumber: 73, kickoff: new Date(), status: "scheduled",
        homeScore: null, awayScore: null,
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
});
