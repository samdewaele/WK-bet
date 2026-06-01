import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    match: { count: vi.fn(), findFirst: vi.fn() },
    notification: { findUnique: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    room: { findMany: vi.fn() },
    roomMember: { findMany: vi.fn() },
    prediction: { count: vi.fn(), groupBy: vi.fn() },
    groupStandingPrediction: { groupBy: vi.fn() },
  },
}));

vi.mock("@/lib/email", () => ({
  emailGroupStageComplete: vi.fn().mockResolvedValue(undefined),
  emailRoundComplete:      vi.fn().mockResolvedValue(undefined),
  emailRoundReminder:      vi.fn().mockResolvedValue(undefined),
}));

import { db } from "@/lib/db";
import { emailRoundReminder } from "@/lib/email";
import { checkAndSendIncompleteReminders } from "@/lib/notifications";

const mockDb = db as any;
const mockEmailRoundReminder = vi.mocked(emailRoundReminder);

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.notification.create.mockResolvedValue({});
});

const MEMBERS = [
  { userId: "u1", user: { id: "u1", name: "Alice", email: "alice@test.com" } },
  { userId: "u2", user: { id: "u2", name: "Bob",   email: "bob@test.com"   } },
];

describe("checkAndSendIncompleteReminders", () => {
  it("sends reminder to ALL members 24h before R32 — regardless of whether they filled predictions", async () => {
    const soonKickoff = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2h from now
    mockDb.notification.findUnique.mockResolvedValue(null);
    mockDb.match.findFirst
      .mockResolvedValueOnce({ id: "m1", kickoff: soonKickoff, round: "R32" }) // Group
      .mockResolvedValueOnce({ id: "m1", kickoff: soonKickoff, round: "R32" }) // R32
      .mockResolvedValue(null); // later rounds
    mockDb.room.findMany.mockResolvedValue([{ id: "r1", name: "Test Group", members: MEMBERS }]);

    await checkAndSendIncompleteReminders();

    // Both members get reminded — no count check
    expect(mockEmailRoundReminder).toHaveBeenCalledWith(
      "alice@test.com", "Alice", expect.any(String), "Test Group", "r1", expect.any(String)
    );
    expect(mockEmailRoundReminder).toHaveBeenCalledWith(
      "bob@test.com", "Bob", expect.any(String), "Test Group", "r1", expect.any(String)
    );
  });

  it("sends Group round reminder when group stage kicks off within 24h", async () => {
    const soonKickoff = new Date(Date.now() + 3 * 60 * 60 * 1000);
    mockDb.notification.findUnique.mockResolvedValue(null);
    // First call (Group round) returns a match; rest return null
    mockDb.match.findFirst
      .mockResolvedValueOnce({ id: "g1", kickoff: soonKickoff, round: "Group" })
      .mockResolvedValue(null);
    mockDb.room.findMany.mockResolvedValue([{ id: "r1", name: "My Group", members: MEMBERS }]);

    await checkAndSendIncompleteReminders();

    const groupCalls = mockEmailRoundReminder.mock.calls.filter((c) => c[2] === "Group");
    expect(groupCalls.length).toBeGreaterThan(0);
    expect(groupCalls[0][0]).toBe("alice@test.com");
  });

  it("skips a round when already notified (wasNotified=true)", async () => {
    // All rounds already notified
    mockDb.notification.findUnique.mockResolvedValue({ type: "reminder:R32" });
    mockDb.match.findFirst.mockResolvedValue({ id: "m1", kickoff: new Date(Date.now() + 60_000) });
    mockDb.room.findMany.mockResolvedValue([{ id: "r1", name: "G", members: MEMBERS }]);

    await checkAndSendIncompleteReminders();

    expect(mockEmailRoundReminder).not.toHaveBeenCalled();
  });

  it("skips a round when the first match is more than 24h away", async () => {
    const farKickoff = new Date(Date.now() + 36 * 60 * 60 * 1000); // 36h from now
    mockDb.notification.findUnique.mockResolvedValue(null);
    mockDb.match.findFirst.mockResolvedValue({ id: "m1", kickoff: farKickoff });
    mockDb.room.findMany.mockResolvedValue([{ id: "r1", name: "G", members: MEMBERS }]);

    await checkAndSendIncompleteReminders();

    expect(mockEmailRoundReminder).not.toHaveBeenCalled();
  });

  it("skips members without an email address", async () => {
    const soonKickoff = new Date(Date.now() + 60 * 60 * 1000);
    mockDb.notification.findUnique.mockResolvedValue(null);
    mockDb.match.findFirst.mockResolvedValueOnce({ id: "m1", kickoff: soonKickoff }).mockResolvedValue(null);
    mockDb.room.findMany.mockResolvedValue([{
      id: "r1", name: "G",
      members: [
        { userId: "u1", user: { id: "u1", name: "Alice", email: null } },
        { userId: "u2", user: { id: "u2", name: "Bob",   email: "bob@test.com" } },
      ],
    }]);

    await checkAndSendIncompleteReminders();

    expect(mockEmailRoundReminder).toHaveBeenCalledTimes(1);
    expect(mockEmailRoundReminder.mock.calls[0][0]).toBe("bob@test.com");
  });
});
