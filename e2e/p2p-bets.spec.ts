/**
 * Step 9 — Side Bets (P2P)
 * Individuals propose personal bets to each other: description + amount.
 * Bets can be accepted, declined, or settled. The page acts as a ledger.
 */
import { test, expect } from "@playwright/test";
import { signInAs, createGroup, E2E_ADMIN_EMAIL, E2E_USER_EMAIL } from "./helpers";

const JOINER_EMAIL = "e2e-p2p-joiner@test.local";

async function joinGroupByCode(
  page: Parameters<typeof signInAs>[0],
  inviteCode: string
) {
  const res = await page.request.put("/api/rooms", { data: { inviteCode } });
  if (!res.ok()) throw new Error(`join failed: ${res.status()} ${await res.text()}`);
}

async function getInviteCode(page: Parameters<typeof signInAs>[0], roomId: string) {
  const res = await page.request.get("/api/groups");
  const groups: { id: string; inviteCode: string }[] = await res.json();
  return groups.find((g) => g.id === roomId)?.inviteCode ?? "";
}

test.describe("P2P Side Bets", () => {
  test("Side Bets tab exists and shows propose-bet button", async ({ page }) => {
    await signInAs(page, E2E_USER_EMAIL, "E2E User");
    const roomId = await createGroup(page, `P2P-Tab-${Date.now()}`);
    await page.goto(`/groups/${roomId}?tab=sidebets-p2p`);

    await expect(page.getByRole("button", { name: /\+ propose bet/i })).toBeVisible();
    await expect(page.getByText(/no p2p bets yet/i)).toBeVisible();
  });

  test("proposer can create a P2P bet", async ({ page }) => {
    await signInAs(page, E2E_USER_EMAIL, "E2E User");
    const roomId = await createGroup(page, `P2P-Create-${Date.now()}`);
    await page.goto(`/groups/${roomId}?tab=sidebets-p2p`);

    await page.getByRole("button", { name: /\+ propose bet/i }).click();

    await page.getByPlaceholder(/what is the bet about/i).fill("Belgium wins the final");
    await page.locator('input[type="number"]').fill("5");

    await page.getByRole("button", { name: /propose bet/i }).click();

    // Bet card appears
    await expect(page.getByText("Belgium wins the final")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("€5.00").first()).toBeVisible();
    await expect(page.getByText(/proposed/i)).toBeVisible();
  });

  test("full P2P bet lifecycle: propose → accept → settle", async ({ page, browser }) => {
    // Owner creates room and proposes a bet
    await signInAs(page, E2E_ADMIN_EMAIL, "Admin", "admin");
    const roomId = await createGroup(page, `P2P-Lifecycle-${Date.now()}`);
    const inviteCode = await getInviteCode(page, roomId);

    // Joiner joins in a second browser context
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await signInAs(page2, JOINER_EMAIL, "Joiner");
    await joinGroupByCode(page2, inviteCode);

    // Owner proposes a bet
    await page.goto(`/groups/${roomId}?tab=sidebets-p2p`);
    await page.getByRole("button", { name: /\+ propose bet/i }).click();
    await page.getByPlaceholder(/what is the bet about/i).fill("Top scorer is Mbappé");
    await page.locator('input[type="number"]').fill("10");
    await page.getByRole("button", { name: /propose bet/i }).click();
    await expect(page.getByText("Top scorer is Mbappé")).toBeVisible({ timeout: 5_000 });

    // Joiner accepts
    await page2.goto(`/groups/${roomId}?tab=sidebets-p2p`);
    await expect(page2.getByText("Top scorer is Mbappé")).toBeVisible({ timeout: 8_000 });
    await page2.getByRole("button", { name: /accept/i }).first().click();
    await expect(page2.getByText(/accepted/i).first()).toBeVisible({ timeout: 5_000 });

    // Owner settles (they won)
    await page.reload();
    await page.getByRole("button", { name: /i won/i }).click();
    await expect(page.getByText(/settled/i).first()).toBeVisible({ timeout: 5_000 });

    await ctx2.close();
  });

  test("proposer can decline their own bet before acceptance", async ({ page }) => {
    await signInAs(page, E2E_USER_EMAIL, "E2E User");
    const roomId = await createGroup(page, `P2P-Decline-${Date.now()}`);
    await page.goto(`/groups/${roomId}?tab=sidebets-p2p`);

    await page.getByRole("button", { name: /\+ propose bet/i }).click();
    await page.getByPlaceholder(/what is the bet about/i).fill("First goal before 10 min");
    await page.locator('input[type="number"]').fill("3");
    await page.getByRole("button", { name: /propose bet/i }).click();
    await expect(page.getByText("First goal before 10 min")).toBeVisible({ timeout: 5_000 });

    await page.getByRole("button", { name: /decline/i }).click();
    await expect(page.getByText(/declined/i)).toBeVisible({ timeout: 5_000 });
  });
});
