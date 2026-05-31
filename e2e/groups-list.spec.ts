/**
 * Step 2 — My Groups page
 * After signing in the user sees a list of their groups.
 * Each card shows the group name, status badge, entry fee, and pot size.
 */
import { test, expect } from "@playwright/test";
import { signInAs, createGroup, setRoomStatus, E2E_USER_EMAIL } from "./helpers";

test.describe("My Groups list", () => {
  test("shows group card with name, status badge, fee, and pot", async ({ page }) => {
    await signInAs(page, E2E_USER_EMAIL, "E2E User");
    const roomId = await createGroup(page, `GL-${Date.now()}`, 20);

    await page.goto("/groups");

    // Card is a link to the group detail
    const card = page.locator(`a[href="/groups/${roomId}"]`);
    await expect(card).toBeVisible();

    // Name
    await expect(card.getByText(/GL-/)).toBeVisible();

    // Status badge — newly created rooms are in "setup"
    await expect(card.getByText(/setup/i)).toBeVisible();

    // Entry fee and pot
    await expect(card.getByText(/€20\.00/).first()).toBeVisible();
    await expect(card.getByText(/1 member/)).toBeVisible();
  });

  test("status badge updates when room transitions to betting", async ({ page }) => {
    await signInAs(page, E2E_USER_EMAIL, "E2E User");
    const roomId = await createGroup(page, `GL-Betting-${Date.now()}`);
    await setRoomStatus(page, roomId, "betting");

    await page.goto("/groups");

    const card = page.locator(`a[href="/groups/${roomId}"]`);
    await expect(card.getByText(/open/i)).toBeVisible({ timeout: 5_000 });
  });

  test("has a create-or-join entry point for adding more groups", async ({ page }) => {
    await signInAs(page, E2E_USER_EMAIL, "E2E User");
    await createGroup(page, `GL-HasGroups-${Date.now()}`);

    await page.goto("/groups");

    // When the user already has groups, a collapsed button to join/create more is shown
    await expect(
      page.getByRole("button", { name: /join or create another group/i })
    ).toBeVisible();
  });

  test("shows empty-state prompt when user has no groups", async ({ page }) => {
    // Use a unique email so no groups exist for this test run
    await signInAs(page, `gl-empty-${Date.now()}@test.local`, "Empty User");

    await page.goto("/groups");

    await expect(page.getByText(/no groups yet/i)).toBeVisible();
    // Both Create and Join forms are visible directly
    await expect(page.getByText(/create group/i).first()).toBeVisible();
    await expect(page.getByText(/join group/i).first()).toBeVisible();
  });
});
