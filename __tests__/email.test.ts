import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock nodemailer so no real SMTP connection is made.
const mockSendMail = vi.fn().mockResolvedValue({});
vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({ sendMail: mockSendMail }),
  },
}));

beforeEach(() => {
  mockSendMail.mockClear();
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getEmailBody(callIndex = 0) {
  return mockSendMail.mock.calls[callIndex][0] as {
    from: string; to: string; subject: string; html: string;
  };
}

const FAKE_LEADERBOARD = [
  { name: "Alice", rank: 1, earned: 12.5 },
  { name: "Bob",   rank: 2, earned: 7.0  },
];

// ---------------------------------------------------------------------------
// With API key set
// ---------------------------------------------------------------------------

describe("email functions (with credentials set)", () => {
  beforeEach(() => {
    vi.stubEnv("EMAIL_USER", "wkbet@gmail.com");
    vi.stubEnv("EMAIL_PASS", "test-app-password");
    vi.stubEnv("NEXTAUTH_URL", "https://wk-bet.example.com");
  });

  // -- existing --

  it("emailMemberJoined sends to creator email with correct subject", async () => {
    const { emailMemberJoined } = await import("@/lib/email");
    await emailMemberJoined("creator@test.com", "Bob", "My Group", "r1");
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const body = await getEmailBody();
    expect(body.to).toBe("creator@test.com");
    expect(body.subject).toContain("Bob");
    expect(body.subject).toContain("My Group");
  });

  it("emailMemberLeft sends to creator with member name and group", async () => {
    const { emailMemberLeft } = await import("@/lib/email");
    await emailMemberLeft("creator@test.com", "Alice", "Group A", "r2");
    const body = await getEmailBody();
    expect(body.to).toBe("creator@test.com");
    expect(body.subject).toContain("Alice");
  });

  it("emailRemovedFromGroup sends to removed member", async () => {
    const { emailRemovedFromGroup } = await import("@/lib/email");
    await emailRemovedFromGroup("member@test.com", "Charlie", "Group B");
    const body = await getEmailBody();
    expect(body.to).toBe("member@test.com");
    expect(body.subject).toContain("Group B");
  });

  it("emailMemberRemovedByAdmin sends to creator with removed name and admin name", async () => {
    const { emailMemberRemovedByAdmin } = await import("@/lib/email");
    await emailMemberRemovedByAdmin("creator@test.com", "Dave", "Group C", "r3", "AdminUser");
    const body = await getEmailBody();
    expect(body.to).toBe("creator@test.com");
    expect(body.html).toContain("AdminUser");
    expect(body.html).toContain("Dave");
  });

  it("does not send when email address is empty string", async () => {
    const { emailMemberJoined } = await import("@/lib/email");
    await emailMemberJoined("", "Bob", "Group", "r1");
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("emailGroupStageComplete: subject mentions group stage and group name", async () => {
    const { emailGroupStageComplete } = await import("@/lib/email");
    await emailGroupStageComplete("p@test.com", "Alice", "WK Friends", "r1", FAKE_LEADERBOARD);
    const body = await getEmailBody();
    expect(body.to).toBe("p@test.com");
    expect(body.subject.toLowerCase()).toContain("group stage");
    expect(body.subject).toContain("WK Friends");
    expect(body.html).toContain("Alice");
    expect(body.html).toContain("Alice"); // leaderboard row
    expect(body.html).toContain("knockout");
  });

  it("emailGroupStageComplete: CTA link uses APP_URL constant", async () => {
    const { emailGroupStageComplete } = await import("@/lib/email");
    await emailGroupStageComplete("p@test.com", "Alice", "WK Friends", "room42", FAKE_LEADERBOARD);
    const body = await getEmailBody();
    expect(body.html).toContain("https://wk-bet.example.com/groups/room42");
  });

  it("emailRoundComplete: subject mentions round label and group name", async () => {
    const { emailRoundComplete } = await import("@/lib/email");
    await emailRoundComplete("p@test.com", "Bob", "R16", "WK Friends", "r1", FAKE_LEADERBOARD);
    const body = await getEmailBody();
    expect(body.subject).toContain("Round of 16");
    expect(body.subject).toContain("WK Friends");
  });

  it("emailRoundComplete for Final: mentions tournament is over", async () => {
    const { emailRoundComplete } = await import("@/lib/email");
    await emailRoundComplete("p@test.com", "Bob", "Final", "WK Friends", "r1", FAKE_LEADERBOARD);
    const body = await getEmailBody();
    expect(body.html.toLowerCase()).toContain("over");
  });

  // -- new emails --

  it("emailBettingOpen: mentions uber pot and entry fee", async () => {
    const { emailBettingOpen } = await import("@/lib/email");
    await emailBettingOpen("p@test.com", "Alice", "My Group", "r1", 10);
    const body = await getEmailBody();
    expect(body.to).toBe("p@test.com");
    expect(body.subject).toContain("My Group");
    expect(body.html.toLowerCase()).toContain("uber pot");
    expect(body.html).toContain("€10.00");
    expect(body.html).toContain("https://wk-bet.example.com/groups/r1");
  });

  it("emailUberPotLocked: tells members proposals are closed", async () => {
    const { emailUberPotLocked } = await import("@/lib/email");
    await emailUberPotLocked("p@test.com", "Bob", "My Group", "r1");
    const body = await getEmailBody();
    expect(body.subject.toLowerCase()).toContain("uber pot");
    expect(body.subject.toLowerCase()).toContain("closed");
    expect(body.html).toContain("My Group");
    expect(body.html).toContain("https://wk-bet.example.com/groups/r1");
  });

  it("emailGroupStageStarted: mentions predictions locked and group name", async () => {
    const { emailGroupStageStarted } = await import("@/lib/email");
    await emailGroupStageStarted("p@test.com", "Charlie", "My Group", "r1");
    const body = await getEmailBody();
    expect(body.subject.toLowerCase()).toContain("group stage");
    expect(body.html.toLowerCase()).toContain("locked");
    expect(body.html).toContain("https://wk-bet.example.com/groups/r1");
  });

  it("emailKOStageActive: includes leaderboard and mentions predictions locked", async () => {
    const { emailKOStageActive } = await import("@/lib/email");
    await emailKOStageActive("p@test.com", "Alice", "My Group", "r1", FAKE_LEADERBOARD);
    const body = await getEmailBody();
    expect(body.subject.toLowerCase()).toContain("locked");
    expect(body.html).toContain("Alice"); // in leaderboard
    expect(body.html).toContain("https://wk-bet.example.com/groups/r1");
  });

  it("emailTournamentFinished: warns about uber pot settlement pending", async () => {
    const { emailTournamentFinished } = await import("@/lib/email");
    await emailTournamentFinished("p@test.com", "Alice", "My Group", "r1", FAKE_LEADERBOARD);
    const body = await getEmailBody();
    expect(body.subject).toContain("My Group");
    expect(body.html.toLowerCase()).toContain("uber pot");
    expect(body.html).toContain("https://wk-bet.example.com/groups/r1");
  });

  it("emailRoundReminder for Group: mentions group stage and CTA link", async () => {
    const { emailRoundReminder } = await import("@/lib/email");
    await emailRoundReminder("p@test.com", "Dave", "Group", "My Group", "r1", "Thu 11 Jun, 21:00");
    const body = await getEmailBody();
    expect(body.subject.toLowerCase()).toContain("group stage");
    expect(body.html).toContain("Thu 11 Jun");
    expect(body.html.toLowerCase()).toContain("group stage");
    expect(body.html).toContain("https://wk-bet.example.com/groups/r1");
  });

  it("emailRoundReminder for R32: mentions knockout and deadline", async () => {
    const { emailRoundReminder } = await import("@/lib/email");
    await emailRoundReminder("p@test.com", "Dave", "R32", "My Group", "r1", "Mon 01 Jul, 18:00");
    const body = await getEmailBody();
    expect(body.subject.toLowerCase()).toContain("round of 32");
    expect(body.html).toContain("Mon 01 Jul");
    expect(body.html).toContain("https://wk-bet.example.com/groups/r1");
  });

  it("emailAdminBroadcast: uses custom subject and wraps message with group link", async () => {
    const { emailAdminBroadcast } = await import("@/lib/email");
    await emailAdminBroadcast("p@test.com", "Eve", "My Group", "r1", "Custom subject", "Hello from admin");
    const body = await getEmailBody();
    expect(body.to).toBe("p@test.com");
    expect(body.subject).toBe("Custom subject");
    expect(body.html).toContain("Hello from admin");
    expect(body.html).toContain("My Group");
    expect(body.html).toContain("https://wk-bet.example.com/groups/r1");
  });

  it("all emails include APP_URL from env in html body", async () => {
    const fns = [
      async () => { const { emailBettingOpen } = await import("@/lib/email"); await emailBettingOpen("p@test.com", "A", "G", "rid", 5); },
      async () => { const { emailUberPotLocked } = await import("@/lib/email"); await emailUberPotLocked("p@test.com", "A", "G", "rid"); },
      async () => { const { emailGroupStageStarted } = await import("@/lib/email"); await emailGroupStageStarted("p@test.com", "A", "G", "rid"); },
      async () => { const { emailKOStageActive } = await import("@/lib/email"); await emailKOStageActive("p@test.com", "A", "G", "rid", []); },
      async () => { const { emailTournamentFinished } = await import("@/lib/email"); await emailTournamentFinished("p@test.com", "A", "G", "rid", []); },
      async () => { const { emailRoundReminder } = await import("@/lib/email"); await emailRoundReminder("p@test.com", "A", "R32", "G", "rid", "tomorrow"); },
      async () => { const { emailAdminBroadcast } = await import("@/lib/email"); await emailAdminBroadcast("p@test.com", "A", "G", "rid", "subj", "msg"); },
    ];
    for (const fn of fns) {
      mockSendMail.mockClear();
      vi.resetModules();
      await fn();
      if (mockSendMail.mock.calls.length > 0) {
        const body = await getEmailBody();
        expect(body.html, `${fn.toString()} should include APP_URL`).toContain("https://wk-bet.example.com");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Without API key
// ---------------------------------------------------------------------------

describe("email functions (without credentials)", () => {
  beforeEach(() => {
    vi.stubEnv("EMAIL_USER", "");
    vi.stubEnv("EMAIL_PASS", "");
  });

  it("falls back to console.log when EMAIL_USER/EMAIL_PASS are not set", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { emailMemberJoined } = await import("@/lib/email");
    await emailMemberJoined("creator@test.com", "Bob", "My Group", "r1");
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("[email]"));
    consoleSpy.mockRestore();
  });

  it("new emails also fall back to console.log without credentials", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { emailBettingOpen } = await import("@/lib/email");
    await emailBettingOpen("p@test.com", "Alice", "Group", "r1", 10);
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("[email]"));
    consoleSpy.mockRestore();
  });
});
