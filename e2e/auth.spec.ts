import { test, expect } from "@playwright/test";
import { signInAs, E2E_USER_EMAIL } from "./helpers";

test("unauthenticated user is redirected to sign-in", async ({ page }) => {
  await page.goto("/groups");
  await expect(page).toHaveURL(/\/auth\/signin/);
});

test("authenticated user lands on groups page", async ({ page }) => {
  await signInAs(page, E2E_USER_EMAIL, "E2E User");
  await page.goto("/groups");
  await expect(page).toHaveURL("/groups");
  // Should NOT be redirected to sign-in
  await expect(page).not.toHaveURL(/\/auth\/signin/);
});
