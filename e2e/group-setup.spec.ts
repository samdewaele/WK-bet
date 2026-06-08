/**
 * Steps 3-7 — Group lifecycle: create, join, admin setup, member management
 *
 * 3  — Create / Join are two clearly separate forms
 * 4  — Creator sets group name and entry fee
 * 5  — Admin opens the admin panel; sets a description; transitions status
 * 6  — Member management via the admin panel and member list
 * 7  — Member list shows invite link, member rows with Creator/You badges
 */
import { test, expect } from "@playwright/test";
import { signInAs, createGroup, E2E_ADMIN_EMAIL, E2E_USER_EMAIL } from "./helpers";

// ── Helpers ────────────────────────────────────────────────────────────────

/** Returns { id, inviteCode } from the rooms list API for the given room. */
async function getInviteCode(page: Parameters<typeof signInAs>[0], roomId: string) {
  const res = await page.request.get("/api/groups");
  const groups: { id: string; inviteCode: string }[] = await res.json();
  return groups.find((g) => g.id === roomId)?.inviteCode ?? "";
}

/** Join via the rooms API (equivalent to the UI form). */
async function joinGroupByCode(page: Parameters<typeof signInAs>[0], inviteCode: string) {
  const res = await page.request.put("/api/rooms", { data: { inviteCode } });
  if (!res.ok()) throw new Error(`join failed: ${res.status()} ${await res.text()}`);
  const d = await res.json();
  return d.id as string;
}

// ── Tests ──────────────────────────────────────────────────────────────────

test.describe("Create group", () => {
  test("create form accepts name and entry fee and redirects to group detail", async ({ page }) => {
    await signInAs(page, `gs-create-${Date.now()}@test.local`, "Creator");
    await page.goto("/groups");

    await page.getByPlaceholder("Group name").fill("Friday Night Bets");
    await page.getByPlaceholder(/entry fee/i).fill("15");
    await page.getByRole("button", { name: /create group/i }).click();

    await page.waitForURL(/\/groups\/.+/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Friday Night Bets" })).toBeVisible();
    await expect(page.getByText(/€15\.00/).first()).toBeVisible();
  });

  test("create and join forms are separate sections on the page", async ({ page }) => {
    await signInAs(page, `gs-sep-${Date.now()}@test.local`, "Sep User");
    await page.goto("/groups");

    // Both headings exist as distinct sections
    await expect(page.getByText("Create Group").first()).toBeVisible();
    await expect(page.getByText("Join Group").first()).toBeVisible();
  });
});

test.describe("Join group", () => {
  test("user can join via invite code and appears in member list", async ({ page, browser }) => {
    // Owner creates the group
    await signInAs(page, E2E_ADMIN_EMAIL, "Admin Owner", "admin");
    const roomId = await createGroup(page, `Join-${Date.now()}`);
    const inviteCode = await getInviteCode(page, roomId);

    // Second user joins in a separate browser context
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await signInAs(page2, E2E_USER_EMAIL, "Joiner");
    await joinGroupByCode(page2, inviteCode);
    await ctx2.close();

    // Owner refreshes members tab — should see 2 members
    await page.goto(`/groups/${roomId}?tab=members`);
    await expect(page.getByRole("heading", { name: /members/i })).toBeVisible();
    await expect(page.getByText("Joiner").first()).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("Admin setup (step 5)", () => {
  test("admin panel is visible to the creator", async ({ page }) => {
    await signInAs(page, E2E_ADMIN_EMAIL, "Admin", "admin");
    const roomId = await createGroup(page, `Admin-${Date.now()}`);
    await page.goto(`/groups/${roomId}`);

    await expect(page.getByRole("button", { name: /admin/i })).toBeVisible();
  });

  test("admin can open panel and save a group description", async ({ page }) => {
    await signInAs(page, E2E_ADMIN_EMAIL, "Admin", "admin");
    const roomId = await createGroup(page, `Desc-${Date.now()}`);
    await page.goto(`/groups/${roomId}`);

    // Open admin panel
    await page.getByRole("button", { name: /admin/i }).click();

    // Fill in description
    await page.getByPlaceholder(/house rules/i).fill("Pay €15 via bank transfer before the first match.");
    await page.getByRole("button", { name: /^save$/i }).click();

    // Wait for "Saved" confirmation
    await expect(page.getByText("Saved")).toBeVisible({ timeout: 5_000 });

    // Description appears in the group header after page refresh
    await page.reload();
    await expect(
      page.getByText("Pay €15 via bank transfer before the first match.")
    ).toBeVisible();
  });

  test("admin can transition room from setup to betting", async ({ page }) => {
    await signInAs(page, E2E_ADMIN_EMAIL, "Admin", "admin");
    const roomId = await createGroup(page, `Status-${Date.now()}`);
    await page.goto(`/groups/${roomId}`);

    await page.getByRole("button", { name: /admin/i }).click();

    // Click the "Open for bets →" transition button
    await page.getByRole("button", { name: /open for bets/i }).click();

    // Status badge should update
    await expect(page.getByText(/open for bets/i).first()).toBeVisible({ timeout: 8_000 });
  });

  test("disband button exists in danger zone", async ({ page }) => {
    await signInAs(page, E2E_ADMIN_EMAIL, "Admin", "admin");
    const roomId = await createGroup(page, `Disband-${Date.now()}`);
    await page.goto(`/groups/${roomId}`);

    await page.getByRole("button", { name: /admin/i }).click();
    await expect(page.getByRole("button", { name: /disband/i })).toBeVisible();
  });
});

test.describe("Member list (step 7)", () => {
  test("members tab shows invite button before tournament starts", async ({ page }) => {
    await signInAs(page, E2E_USER_EMAIL, "E2E User");
    const roomId = await createGroup(page, `Mem-${Date.now()}`);
    await page.goto(`/groups/${roomId}?tab=members`);

    // Invite button (copies link to clipboard)
    await expect(page.getByRole("button", { name: /invite/i }).first()).toBeVisible();
  });

  test("creator appears with Creator badge", async ({ page }) => {
    await signInAs(page, E2E_USER_EMAIL, "E2E User");
    const roomId = await createGroup(page, `Creator-Badge-${Date.now()}`);
    await page.goto(`/groups/${roomId}?tab=members`);

    await expect(page.getByText("Creator").first()).toBeVisible();
    await expect(page.getByText("You").first()).toBeVisible();
  });

  test("admin can toggle paid status on a member", async ({ page }) => {
    await signInAs(page, E2E_ADMIN_EMAIL, "Admin", "admin");
    const roomId = await createGroup(page, `Paid-${Date.now()}`);
    await page.goto(`/groups/${roomId}?tab=members`);

    // Initially unpaid
    const unpaidBtn = page.getByRole("button", { name: /unpaid/i });
    await expect(unpaidBtn).toBeVisible();

    // Click to mark paid
    await unpaidBtn.click();
    await expect(page.getByRole("button", { name: /✓ paid/i })).toBeVisible({ timeout: 5_000 });
  });
});
