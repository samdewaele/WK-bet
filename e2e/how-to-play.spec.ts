/**
 * Step 8 — How to play page
 * Static rules page — no forms or actionable elements.
 */
import { test, expect } from "@playwright/test";
import { signInAs, createGroup, E2E_USER_EMAIL } from "./helpers";

test.describe("How to play", () => {
  test("rules page shows prize breakdown, group stage, and knockout sections", async ({ page }) => {
    await signInAs(page, E2E_USER_EMAIL, "E2E User");
    const roomId = await createGroup(page, `HTP-${Date.now()}`);

    await page.goto(`/groups/${roomId}/rules`);

    await expect(page.getByText("How It Works")).toBeVisible();
    await expect(page.getByText(/the pot/i)).toBeVisible();
    await expect(page.getByText(/group stage predictions/i)).toBeVisible();
    await expect(page.getByText(/knockout predictions/i)).toBeVisible();
    await expect(page.getByText(/player vs player bets/i)).toBeVisible();
    await expect(page.getByText(/prediction deadlines/i)).toBeVisible();
  });

  test("no form fields or submit buttons on the rules page", async ({ page }) => {
    await signInAs(page, E2E_USER_EMAIL, "E2E User");
    const roomId = await createGroup(page, `HTP-NoForm-${Date.now()}`);

    await page.goto(`/groups/${roomId}/rules`);

    // No input elements
    await expect(page.locator("input")).toHaveCount(0);
    // No form submit buttons (back link is just an anchor)
    await expect(page.locator("form")).toHaveCount(0);
  });

  test("back link returns to group detail", async ({ page }) => {
    await signInAs(page, E2E_USER_EMAIL, "E2E User");
    const roomId = await createGroup(page, `HTP-Back-${Date.now()}`);

    await page.goto(`/groups/${roomId}/rules`);

    await page.getByText(/← back to group/i).click();
    await page.waitForURL(`/groups/${roomId}`, { timeout: 10_000 });
  });

  test("How to play tab in group detail navigates to rules page", async ({ page }) => {
    await signInAs(page, E2E_USER_EMAIL, "E2E User");
    const roomId = await createGroup(page, `HTP-Tab-${Date.now()}`);

    await page.goto(`/groups/${roomId}`);
    await page.getByRole("link", { name: /how to play/i }).click();

    await page.waitForURL(`/groups/${roomId}/rules`, { timeout: 10_000 });
  });
});
