/**
 * End-to-end tests for the visual KO bracket (My predictions → Knockout).
 * Covers:
 *   1. The bracket is the default KO view and renders all six round columns.
 *   2. The Bracket ⇄ List toggle switches to the legacy round-tab list.
 *   3. Editing a score in a bracket tile auto-saves.
 */
import { test, expect } from "@playwright/test";
import {
  signInAs,
  createGroup,
  createSideBet,
  runPhase1,
  E2E_ADMIN_EMAIL,
} from "./helpers";

test.describe("KO bracket", () => {
  let roomId: string;

  test.beforeEach(async ({ page }) => {
    await signInAs(page, E2E_ADMIN_EMAIL, "E2E Admin", "admin");
    roomId = await createGroup(page, `Bracket-${Date.now()}`);
    // Phase 1 requires at least one open Uber Pot bet, then opens KO betting.
    await createSideBet(page, roomId);
    await runPhase1(page, roomId);
  });

  test("renders the visual bracket with all round columns by default", async ({ page }) => {
    await page.goto(`/groups/${roomId}?tab=predictions`);

    // Round-column headers across the tree (R32 → FINAL). Multiple R32/QF/SF
    // columns exist (left + right halves), so assert at least one of each.
    for (const label of ["R32", "R16", "QF", "SF", "FINAL"]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible({
        timeout: 15_000,
      });
    }

    // The final/3rd-place tiles live in the centre column.
    await expect(page.getByText(/🏆 FINAL/).first()).toBeVisible();
    await expect(page.getByText(/🥉 3RD/).first()).toBeVisible();

    // Tiles carry score inputs for editing directly in the bracket.
    await expect(page.locator('input[type="number"]').first()).toBeVisible();

    // Each tile shows its playing date ("dd Mon, HH:mm") pulled from the match
    // kickoff. The seed gives KO matches real future dates, so a date must show.
    await expect(
      page.getByText(/\d{2}\s\w{3},?\s\d{2}:\d{2}/).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Bracket ⇄ List toggle switches to the legacy round-tab view", async ({ page }) => {
    await page.goto(`/groups/${roomId}?tab=predictions`);

    // Switch to List — the round tabs (Round of 32 …) appear.
    await page.getByRole("button", { name: /☰ List/i }).click();
    await expect(
      page.getByRole("button", { name: /round of 32/i })
    ).toBeVisible({ timeout: 10_000 });

    // Switch back to Bracket — round tabs gone, FINAL column header returns.
    await page.getByRole("button", { name: /🏆 Bracket/i }).click();
    await expect(
      page.getByRole("button", { name: /round of 32/i })
    ).not.toBeVisible();
    await expect(page.getByText("FINAL").first()).toBeVisible();
  });

  test("editing a score in a bracket tile auto-saves", async ({ page }) => {
    await page.goto(`/groups/${roomId}?tab=predictions`);

    const inputs = page.locator('input[type="number"]');
    await inputs.nth(0).fill("2");
    await inputs.nth(1).fill("1");

    // Auto-save fires after a short debounce; the tile shows a ✓ indicator.
    await expect(page.getByText("✓").first()).toBeVisible({ timeout: 5_000 });
  });
});
