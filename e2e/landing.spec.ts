/**
 * Step 1 — Landing page
 * An unauthenticated visitor sees the hero, "Sign in" and "Get started" buttons.
 */
import { test, expect } from "@playwright/test";

test.describe("Landing page (unauthenticated)", () => {
  test("shows hero content", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/FIFA World Cup 2026/i)).toBeVisible();
    await expect(page.getByText(/Bet with friends/i)).toBeVisible();
  });

  test("Sign in button is visible", async ({ page }) => {
    await page.goto("/");
    // Hero CTA button contains "Sign in"
    await expect(
      page.getByRole("button", { name: /sign in/i }).first()
    ).toBeVisible();
  });

  test("Get started button is visible", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: /get started/i })
    ).toBeVisible();
  });

  test("How it works section is present", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/how it works/i)).toBeVisible();
    await expect(page.getByText(/create a group/i)).toBeVisible();
    await expect(page.getByText(/make your predictions/i)).toBeVisible();
    await expect(page.getByText(/win the pot/i)).toBeVisible();
  });

  test("Prize breakdown section lists group and knockout halves", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/50%.*group stage/i)).toBeVisible();
    await expect(page.getByText(/50%.*knockout/i)).toBeVisible();
    await expect(page.getByText(/Uber Pot/i).first()).toBeVisible();
  });
});
