import { test, expect } from "@playwright/test";
import { signInAs, createGroup, setRoomStatus, E2E_USER_EMAIL } from "./helpers";

test.describe("Group stage predictions", () => {
  test("predictions are editable while room is in betting state", async ({ page }) => {
    await signInAs(page, E2E_USER_EMAIL, "E2E Predictor");
    const roomId = await createGroup(page, `Preds-Open-${Date.now()}`);

    await page.goto(`/groups/${roomId}?tab=predictions`);

    // In betting status, group cards should NOT show the global locked banner
    await expect(
      page.getByText("Group stage predictions are locked")
    ).not.toBeVisible();

    // Dropdowns should be present (not locked static text)
    const firstSelect = page.locator("select").first();
    await expect(firstSelect).toBeVisible();
  });

  test("all group predictions lock simultaneously when room advances to group_active", async ({
    page,
  }) => {
    await signInAs(page, E2E_USER_EMAIL, "E2E Predictor");
    const roomId = await createGroup(page, `Preds-Lock-${Date.now()}`);

    // Advance to group_active (tournament started)
    await setRoomStatus(page, roomId, "group_active");

    await page.goto(`/groups/${roomId}?tab=predictions`);

    // Global locked banner should appear
    await expect(
      page.getByText("Group stage predictions are locked")
    ).toBeVisible();

    // No dropdowns should be present — all groups show static locked view
    const selects = page.locator("select");
    await expect(selects).toHaveCount(0);

    // All group cards should show the Locked badge
    const lockedBadges = page.getByText("Locked");
    await expect(lockedBadges.first()).toBeVisible();
  });
});
