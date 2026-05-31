/**
 * End-to-end tests for the simulation flow.
 * These cover the most regression-prone paths:
 *   1. KO predictions become available after Phase 1
 *   2. Leaderboard shows data after Phase 2
 *   3. Leaderboard clears + KO bracket disappears after cleanup
 */
import { test, expect } from "@playwright/test";
import {
  signInAs,
  createGroup,
  runPhase1,
  runPhase2,
  runCleanup,
  E2E_ADMIN_EMAIL,
} from "./helpers";

test.describe("Simulation flow", () => {
  let roomId: string;

  test.beforeEach(async ({ page }) => {
    await signInAs(page, E2E_ADMIN_EMAIL, "E2E Admin", "admin");
    roomId = await createGroup(page, `Sim-${Date.now()}`);
    // Advance to betting so the group is ready for simulation
    // (createGroup starts in setup; admin panel transitions it)
  });

  // ── Phase 1 ──────────────────────────────────────────────────────────────

  test("Phase 1: KO predictions become available after group stage simulation", async ({
    page,
  }) => {
    await runPhase1(page, roomId);

    await page.goto(`/groups/${roomId}?tab=predictions`);

    // The "bracket opens after group stage" placeholder must be gone
    await expect(
      page.getByText(/bracket opens after group stage/i)
    ).not.toBeVisible({ timeout: 15_000 });

    // Round-of-32 tab / heading should appear
    await expect(
      page.getByRole("button", { name: /round of 32/i })
    ).toBeVisible({ timeout: 15_000 });
  });

  test("Phase 1: room status banner shows KO betting window message", async ({
    page,
  }) => {
    await runPhase1(page, roomId);

    await page.goto(`/groups/${roomId}`);

    await expect(
      page.getByText(/fill in your knockout bracket predictions/i)
    ).toBeVisible({ timeout: 10_000 });
  });

  // ── Phase 2 ──────────────────────────────────────────────────────────────

  test("Phase 2: leaderboard shows earnings after KO stage simulation", async ({
    page,
  }) => {
    await runPhase1(page, roomId);
    await runPhase2(page, roomId);

    await page.goto(`/groups/${roomId}?tab=standings`);

    // "No standings yet" placeholder must NOT be shown
    await expect(page.getByText(/no standings yet/i)).not.toBeVisible({
      timeout: 15_000,
    });

    // The leaderboard table should be visible with at least one row
    await expect(page.locator("table")).toBeVisible();
    await expect(page.locator("tbody tr").first()).toBeVisible();
  });

  // ── Cleanup ───────────────────────────────────────────────────────────────

  test("Cleanup: standings tab disappears and KO bracket resets", async ({
    page,
  }) => {
    await runPhase1(page, roomId);
    await runPhase2(page, roomId);
    await runCleanup(page, roomId);

    await page.goto(`/groups/${roomId}`);

    // After cleanup room is back to "betting" → standings tab is hidden
    await expect(page.getByRole("link", { name: "Standings" })).not.toBeVisible(
      { timeout: 10_000 }
    );

    // KO bracket should show the "opens after group stage" placeholder again
    await page.goto(`/groups/${roomId}?tab=predictions`);
    await expect(
      page.getByText(/bracket opens after group stage/i)
    ).toBeVisible({ timeout: 15_000 });
  });

  test("Cleanup: group stage predictions are unlocked again after cleanup", async ({
    page,
  }) => {
    await runPhase1(page, roomId);
    await runCleanup(page, roomId);

    await page.goto(`/groups/${roomId}?tab=predictions`);

    // Back to betting → no global lock banner
    await expect(
      page.getByText("Group stage predictions are locked")
    ).not.toBeVisible({ timeout: 10_000 });

    // Dropdowns should be back
    await expect(page.locator("select").first()).toBeVisible();
  });
});
