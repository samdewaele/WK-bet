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
  createSideBet,
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
    // Phase 1 simulation requires at least 1 open Uber Pot bet in the room
    await createSideBet(page, roomId);
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

  // ── KO predictions (Phase 1 → ko_betting) ────────────────────────────────

  test("Phase 1 → KO: filling in a tied score shows the penalty-winner selector", async ({
    page,
  }) => {
    await runPhase1(page, roomId);

    await page.goto(`/groups/${roomId}?tab=predictions`);
    await page.getByRole("button", { name: /round of 32/i }).click();

    // Fill in a drawn score for the first match
    const inputs = page.locator('input[type="number"]');
    await inputs.nth(0).fill("1");
    await inputs.nth(1).fill("1");

    // Penalty winner selector must appear
    await expect(page.getByText(/penalty winner/i)).toBeVisible({ timeout: 3_000 });
    // Two team buttons available
    const penaltyBtns = page.locator('[class*="penalty"], button:near(:text("Penalty winner"))');
    // Just verify both penalty buttons are rendered by checking "Penalty winner" text exists
    // and that clicking one removes the highlight state (not already selected)
    const firstPenBtn = page.locator('div:has(> span:text-matches("Penalty winner", "i")) button').first();
    await firstPenBtn.click();
    await expect(firstPenBtn).toHaveClass(/bg-amber-400/, { timeout: 2_000 });
  });

  test("Phase 1 → KO: non-tied score auto-saves (shows ✓ indicator)", async ({
    page,
  }) => {
    await runPhase1(page, roomId);

    await page.goto(`/groups/${roomId}?tab=predictions`);
    await page.getByRole("button", { name: /round of 32/i }).click();

    // Fill in a decisive score for the first match
    const inputs = page.locator('input[type="number"]');
    await inputs.nth(0).fill("2");
    await inputs.nth(1).fill("0");

    // Auto-save fires after 700ms; allow up to 4s for network round-trip
    await expect(page.getByText("✓").first()).toBeVisible({ timeout: 4_000 });
  });

  test("Phase 1 → KO: Save all button saves all filled predictions at once", async ({
    page,
  }) => {
    await runPhase1(page, roomId);

    await page.goto(`/groups/${roomId}?tab=predictions`);
    await page.getByRole("button", { name: /round of 32/i }).click();

    // Fill scores for two matches
    const inputs = page.locator('input[type="number"]');
    await inputs.nth(0).fill("3");
    await inputs.nth(1).fill("1");
    await inputs.nth(2).fill("2");
    await inputs.nth(3).fill("0");

    // "Save all" button should reflect filled count
    await expect(page.getByText(/2\//)).toBeVisible({ timeout: 2_000 });

    // Clicking Save all shows Saved! confirmation
    await page.getByRole("button", { name: /save all/i }).click();
    await expect(page.getByRole("button", { name: /saved!/i })).toBeVisible({ timeout: 5_000 });
  });

  test("Phase 1 → KO: admin panel shows correct prediction count after saving", async ({
    page,
  }) => {
    await runPhase1(page, roomId);

    // Fetch all KO match IDs and POST predictions for all of them via API
    const koRes = await page.request.get(`/api/groups/${roomId}/knockout`);
    const koPreds: { matchId: string; match: { homeScore: null } }[] = await koRes.json();

    const predictions = koPreds.map((p) => ({
      matchId: p.matchId,
      homeScore: 2,
      awayScore: 1,
    }));
    const saveRes = await page.request.post(`/api/groups/${roomId}/knockout`, {
      data: { predictions },
    });
    expect(saveRes.ok()).toBe(true);

    const total = koPreds.length;

    // Admin opens admin panel and refreshes member stats
    await page.goto(`/groups/${roomId}`);
    await page.getByRole("button", { name: /admin/i }).click();

    // Refresh stats (the button already exists in the panel)
    const refreshBtn = page.getByRole("button", { name: /↻ Refresh/i });
    if (await refreshBtn.isVisible()) await refreshBtn.click();

    // Admin's own KO prediction count should now show total/total
    await expect(
      page.getByText(new RegExp(`${total}\\/${total}`))
    ).toBeVisible({ timeout: 8_000 });
  });

  test("Phase 1 → KO: simulation users show exact KO count, not inflated by group predictions", async ({
    page,
  }) => {
    // Regression: before dedicated KOPrediction table, simulation users stored
    // both group stage (48) and KO (32) predictions with roomId, so the count
    // query returned 80+ instead of 32. Verify via the admin members API (the
    // same data source the admin panel displays) that Alice has exactly 32.
    await runPhase1(page, roomId);

    const statsRes = await page.request.get(`/api/admin/groups/${roomId}/members`);
    expect(statsRes.ok()).toBeTruthy();
    const stats: { name: string | null; koPredictions: number; totalKOMatches: number }[] =
      await statsRes.json();
    const aliceStat = stats.find((m) => m.name === "Alice");
    expect(aliceStat).toBeDefined();
    expect(aliceStat!.koPredictions).toBe(32);
    expect(aliceStat!.koPredictions).toBe(aliceStat!.totalKOMatches);
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
