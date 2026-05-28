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
  emailRoundComplete: vi.fn().mockResolvedValue(undefined),
  emailIncompleteReminder: vi.fn().mockResolvedValue(undefined),
}));

import { db } from "@/lib/db";
import { emailIncompleteReminder } from "@/lib/email";
import { checkAndSendIncompleteReminders } from "@/lib/notifications";

const mockDb = db as any;
const mockEmailIncompleteReminder = vi.mocked(emailIncompleteReminder);

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.notification.create.mockResolvedValue({});
});

describe("checkAndSendIncompleteReminders", () => {
  it("does NOT send reminders for the Group round (group match scores are bonus-only)", async () => {
    // Set up: the "Group" round has a match kicking off within 24h
    // but we should NOT send reminders for it
    const now = new Date();
    const soonKickoff = new Date(now.getTime() + 2 * 60 * 60 * 1000); // 2h from now

    // wasNotified returns null (not notified yet)
    mockDb.notification.findUnique.mockResolvedValue(null);

    // Only one upcoming match (R32) within 24h
    mockDb.match.findFirst.mockResolvedValueOnce({
      id: "m1",
      kickoff: soonKickoff,
      round: "R32",
    });
    // All other rounds: no matches coming up
    mockDb.match.findFirst.mockResolvedValue(null);

    mockDb.room.findMany.mockResolvedValue([
      {
        id: "r1",
        name: "Test Group",
        members: [
          { userId: "u1", user: { id: "u1", name: "Alice", email: "alice@test.com" } },
        ],
      },
    ]);

    mockDb.match.count.mockResolvedValue(8);
    mockDb.prediction.count.mockResolvedValue(0); // 0 predictions made

    await checkAndSendIncompleteReminders();

    // Should have sent for R32 (missing predictions)
    expect(mockEmailIncompleteReminder).toHaveBeenCalledWith(
      "alice@test.com",
      "Alice",
      "R32",
      "Test Group",
      "r1",
      expect.any(String),
      8,
    );
  });

  it("does NOT send Group-round reminders even when Group match is imminent", async () => {
    const now = new Date();
    const soonKickoff = new Date(now.getTime() + 1 * 60 * 60 * 1000); // 1h from now

    mockDb.notification.findUnique.mockResolvedValue(null);
    // Return a Group round match as the first upcoming match
    // This should be skipped since we only check REMINDER_ROUNDS (not Group)
    mockDb.match.findFirst.mockResolvedValue(null); // All KO rounds have no upcoming match

    mockDb.room.findMany.mockResolvedValue([
      {
        id: "r1",
        members: [
          { userId: "u1", user: { id: "u1", name: "Bob", email: "bob@test.com" } },
        ],
      },
    ]);

    await checkAndSendIncompleteReminders();

    // Group round reminders should never be sent regardless
    const groupCalls = mockEmailIncompleteReminder.mock.calls.filter(
      (call) => call[2] === "Group"
    );
    expect(groupCalls).toHaveLength(0);
  });
});
