import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockResolvedValue({ ok: true, text: async () => "" });
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("email functions (with API key set)", () => {
  beforeEach(() => {
    vi.stubEnv("RESEND_API_KEY", "test-key");
    vi.stubEnv("EMAIL_FROM", "WK-Bet <test@example.com>");
  });

  it("emailMemberJoined sends to creator email with correct subject", async () => {
    const { emailMemberJoined } = await import("@/lib/email");
    await emailMemberJoined("creator@test.com", "Bob", "My Group", "r1");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
      }),
    );
    const body = JSON.parse((mockFetch.mock.calls[0][1] as any).body);
    expect(body.to).toBe("creator@test.com");
    expect(body.subject).toContain("Bob");
    expect(body.subject).toContain("My Group");
  });

  it("emailMemberLeft sends to creator with member name and group", async () => {
    const { emailMemberLeft } = await import("@/lib/email");
    await emailMemberLeft("creator@test.com", "Alice", "Group A", "r2");
    const body = JSON.parse((mockFetch.mock.calls[0][1] as any).body);
    expect(body.to).toBe("creator@test.com");
    expect(body.subject).toContain("Alice");
  });

  it("emailRemovedFromGroup sends to removed member", async () => {
    const { emailRemovedFromGroup } = await import("@/lib/email");
    await emailRemovedFromGroup("member@test.com", "Charlie", "Group B");
    const body = JSON.parse((mockFetch.mock.calls[0][1] as any).body);
    expect(body.to).toBe("member@test.com");
    expect(body.subject).toContain("Group B");
  });

  it("emailMemberRemovedByAdmin sends to creator with removed name and admin name", async () => {
    const { emailMemberRemovedByAdmin } = await import("@/lib/email");
    await emailMemberRemovedByAdmin("creator@test.com", "Dave", "Group C", "r3", "AdminUser");
    const body = JSON.parse((mockFetch.mock.calls[0][1] as any).body);
    expect(body.to).toBe("creator@test.com");
    expect(body.html).toContain("AdminUser");
    expect(body.html).toContain("Dave");
  });

  it("does not send when email address is empty string", async () => {
    const { emailMemberJoined } = await import("@/lib/email");
    await emailMemberJoined("", "Bob", "Group", "r1");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("email functions (without API key)", () => {
  beforeEach(() => {
    vi.stubEnv("RESEND_API_KEY", "");
  });

  it("falls back to console.log when RESEND_API_KEY is not set", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { emailMemberJoined } = await import("@/lib/email");
    await emailMemberJoined("creator@test.com", "Bob", "My Group", "r1");
    expect(mockFetch).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[email]"),
    );
    consoleSpy.mockRestore();
  });
});
