/**
 * Step 10 — Uber Pot bets (predictions tab)
 * Admins create Uber Pot bets; members propose bets (admin approves/rejects).
 * Members submit answers before the admin locks the list.
 * After tournament admin settles by picking the winning answer.
 *
 * This spec also covers the admin lock feature (step 10 requirement).
 */
import { test, expect } from "@playwright/test";
import { signInAs, createGroup, createSideBet, E2E_ADMIN_EMAIL, E2E_USER_EMAIL } from "./helpers";

const MEMBER_EMAIL = "e2e-uber-member@test.local";

async function joinGroupByCode(page: Parameters<typeof signInAs>[0], inviteCode: string) {
  const res = await page.request.put("/api/rooms", { data: { inviteCode } });
  if (!res.ok()) throw new Error(`join failed: ${res.status()} ${await res.text()}`);
}

async function getInviteCode(page: Parameters<typeof signInAs>[0], roomId: string) {
  const res = await page.request.get("/api/groups");
  const groups: { id: string; inviteCode: string }[] = await res.json();
  return groups.find((g) => g.id === roomId)?.inviteCode ?? "";
}

async function lockUberPot(page: Parameters<typeof signInAs>[0], roomId: string) {
  const res = await page.request.patch(`/api/admin/groups/${roomId}`, {
    data: { uberBetsLocked: true },
  });
  if (!res.ok()) throw new Error(`lockUberPot failed: ${res.status()} ${await res.text()}`);
}

test.describe("Uber Pot bets", () => {
  test("Uber Pot section appears in predictions tab", async ({ page }) => {
    await signInAs(page, E2E_ADMIN_EMAIL, "Admin", "admin");
    const roomId = await createGroup(page, `UP-Section-${Date.now()}`);
    await page.goto(`/groups/${roomId}?tab=predictions`);

    await expect(page.getByText(/uber pot bets/i).first()).toBeVisible();
  });

  test("admin can create an Uber Pot bet that appears as open", async ({ page }) => {
    await signInAs(page, E2E_ADMIN_EMAIL, "Admin", "admin");
    const roomId = await createGroup(page, `UP-Create-${Date.now()}`);
    await page.goto(`/groups/${roomId}?tab=predictions`);

    // Fill in the create form
    await page.getByPlaceholder(/question \/ title/i).fill("Who wins the Golden Boot?");
    await page.getByRole("button", { name: /^create$/i }).click();

    await expect(page.getByText("Who wins the Golden Boot?")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/open/i).first()).toBeVisible();
  });

  test("member can propose an Uber Pot bet which shows as pending", async ({ page }) => {
    await signInAs(page, E2E_USER_EMAIL, "E2E User");
    const roomId = await createGroup(page, `UP-Propose-${Date.now()}`);
    await page.goto(`/groups/${roomId}?tab=predictions`);

    await page.getByPlaceholder(/question \/ title/i).fill("Which team scores first?");
    await page.getByRole("button", { name: /^propose$/i }).click();

    await expect(page.getByText("Which team scores first?")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/pending/i)).toBeVisible();
  });

  test("admin can accept a proposed Uber Pot bet", async ({ page, browser }) => {
    // Admin creates group
    await signInAs(page, E2E_ADMIN_EMAIL, "Admin", "admin");
    const roomId = await createGroup(page, `UP-Accept-${Date.now()}`);
    const inviteCode = await getInviteCode(page, roomId);

    // Member joins and proposes
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await signInAs(page2, MEMBER_EMAIL, "Member");
    await joinGroupByCode(page2, inviteCode);
    await page2.goto(`/groups/${roomId}?tab=predictions`);
    await page2.getByPlaceholder(/question \/ title/i).fill("First red card team?");
    await page2.getByRole("button", { name: /^propose$/i }).click();
    await expect(page2.getByText("First red card team?")).toBeVisible({ timeout: 5_000 });
    await ctx2.close();

    // Admin sees and accepts the proposal
    await page.goto(`/groups/${roomId}?tab=predictions`);
    await expect(page.getByText("First red card team?")).toBeVisible({ timeout: 5_000 });
    await page.getByRole("button", { name: /✓ accept/i }).click();
    await expect(page.getByText(/^open$/i).first()).toBeVisible({ timeout: 5_000 });
  });

  test("member can submit an answer to an open bet", async ({ page }) => {
    await signInAs(page, E2E_ADMIN_EMAIL, "Admin", "admin");
    const roomId = await createGroup(page, `UP-Answer-${Date.now()}`);
    await createSideBet(page, roomId, "Top scorer?");
    await page.goto(`/groups/${roomId}?tab=predictions`);

    await page.getByPlaceholder(/your answer/i).fill("Mbappé");
    await page.getByRole("button", { name: /submit/i }).click();

    await expect(page.getByText(/your answer submitted/i)).toBeVisible({ timeout: 5_000 });
  });

  test("admin can lock Uber Pot bets — new proposals are rejected", async ({ page }) => {
    await signInAs(page, E2E_ADMIN_EMAIL, "Admin", "admin");
    const roomId = await createGroup(page, `UP-Lock-${Date.now()}`);

    // Lock via admin panel
    await page.goto(`/groups/${roomId}`);
    await page.getByRole("button", { name: /admin/i }).click();
    await page.getByRole("button", { name: /🔓 unlocked/i }).click();
    await expect(page.getByRole("button", { name: /🔒 locked/i })).toBeVisible({ timeout: 5_000 });

    // After reload, the predictions tab create form should be hidden
    await page.goto(`/groups/${roomId}?tab=predictions`);
    await expect(page.getByPlaceholder(/question \/ title/i)).not.toBeVisible();
    await expect(page.getByText(/locked by admin/i)).toBeVisible();
  });

  test("after lock, API also rejects new proposals with 403", async ({ page }) => {
    await signInAs(page, E2E_ADMIN_EMAIL, "Admin", "admin");
    const roomId = await createGroup(page, `UP-Lock-API-${Date.now()}`);
    await lockUberPot(page, roomId);

    const res = await page.request.post(`/api/groups/${roomId}/sidebets`, {
      data: { title: "Locked bet attempt" },
    });
    expect(res.status()).toBe(403);
  });
});
