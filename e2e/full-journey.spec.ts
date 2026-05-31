/**
 * Full betting journey — steps 8-15 (group stage → KO → settle → close)
 *
 * Preset simulation: home team always wins 2-0 in every match.
 * Group standings (deterministic): first-listed team > second > third > fourth.
 *   Group A: USA > Panama > Honduras > Morocco
 *   Group B: Argentina > Chile > Peru > Australia  (etc.)
 * Total group goals: 72 matches × 2 = 144.
 *
 * Prediction scenario:
 *   Admin → Group A correct, Group B correct
 *   Member → Group A wrong (top-2 swapped), Group B correct
 *   Groups C-L → no predictions → all those prizes flow to Uber Pot
 *
 * KO predictions:
 *   Admin → home wins (2-0) for every match → all correct → earns KO prize
 *   Member → away wins (0-2) for every match → all wrong  → earns nothing
 *
 * Uber Pot bets:
 *   "Total goals in group stage" — admin answers "144" (correct), member "999" (wrong)
 *   "Top scorer" (member proposes, admin accepts) — admin "Mbappe", member "Haaland"
 *   Admin settles "Total goals" → admin's "144" wins
 *   Admin settles "Top scorer" → member's "Haaland" wins
 */
import { test, expect } from "@playwright/test";
import { signInAs, createGroup, E2E_ADMIN_EMAIL } from "./helpers";

const MEMBER_EMAIL = "e2e-journey-member@test.local";

async function joinGroup(page: Parameters<typeof signInAs>[0], inviteCode: string) {
  const res = await page.request.put("/api/rooms", { data: { inviteCode } });
  if (!res.ok()) throw new Error(`joinGroup failed: ${res.status()} ${await res.text()}`);
}

async function getInviteCode(page: Parameters<typeof signInAs>[0], roomId: string): Promise<string> {
  const res = await page.request.get("/api/groups");
  const groups: { id: string; inviteCode: string }[] = await res.json();
  return groups.find((g) => g.id === roomId)?.inviteCode ?? "";
}

test.describe("Full betting journey", () => {
  let roomId: string;

  test.afterEach(async ({ page }) => {
    if (!roomId) return;
    await page.request.delete("/api/e2e/tournament-run", { data: { roomId } });
  });

  test("complete betting lifecycle: setup → group stage → KO → settle → close", async ({
    page,
    browser,
  }) => {
    // ── 1. Setup ──────────────────────────────────────────────────────────────
    await signInAs(page, E2E_ADMIN_EMAIL, "Admin", "admin");
    roomId = await createGroup(page, `Journey-${Date.now()}`);
    const inviteCode = await getInviteCode(page, roomId);

    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await signInAs(page2, MEMBER_EMAIL, "Member");
    await joinGroup(page2, inviteCode);

    // ── 2. Uber Pot bets ──────────────────────────────────────────────────────

    // Admin creates "Total goals in group stage" → status open immediately
    const totalGoalsRes = await page.request.post(`/api/groups/${roomId}/sidebets`, {
      data: { title: "Total goals in group stage" },
    });
    expect(totalGoalsRes.ok()).toBeTruthy();
    const { id: totalGoalsBetId } = await totalGoalsRes.json();

    // Member proposes "Top scorer" → status pending
    const topScorerProposeRes = await page2.request.post(`/api/groups/${roomId}/sidebets`, {
      data: { title: "Top scorer" },
    });
    expect(topScorerProposeRes.ok()).toBeTruthy();
    const { id: topScorerBetId } = await topScorerProposeRes.json();

    // Admin accepts the proposal
    const acceptRes = await page.request.patch(`/api/groups/${roomId}/sidebets`, {
      data: { sideBetId: topScorerBetId, action: "accept" },
    });
    expect(acceptRes.ok()).toBeTruthy();

    // UI: predictions tab shows both bets
    await page.goto(`/groups/${roomId}?tab=predictions`);
    await expect(page.getByText("Total goals in group stage")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Top scorer")).toBeVisible({ timeout: 5_000 });

    // ── 3. Submit Uber Pot answers ────────────────────────────────────────────

    const adminTotalGoalsEntryRes = await page.request.post(
      `/api/groups/${roomId}/sidebets/${totalGoalsBetId}/entries`,
      { data: { answer: "144" } }
    );
    expect(adminTotalGoalsEntryRes.ok()).toBeTruthy();
    const { id: adminTotalGoalsEntryId } = await adminTotalGoalsEntryRes.json();

    const memberTotalGoalsEntryRes = await page2.request.post(
      `/api/groups/${roomId}/sidebets/${totalGoalsBetId}/entries`,
      { data: { answer: "999" } }
    );
    expect(memberTotalGoalsEntryRes.ok()).toBeTruthy();

    const adminTopScorerEntryRes = await page.request.post(
      `/api/groups/${roomId}/sidebets/${topScorerBetId}/entries`,
      { data: { answer: "Mbappe" } }
    );
    expect(adminTopScorerEntryRes.ok()).toBeTruthy();

    const memberTopScorerEntryRes = await page2.request.post(
      `/api/groups/${roomId}/sidebets/${topScorerBetId}/entries`,
      { data: { answer: "Haaland" } }
    );
    expect(memberTopScorerEntryRes.ok()).toBeTruthy();
    const { id: memberTopScorerEntryId } = await memberTopScorerEntryRes.json();

    // ── 4. Group standing predictions ─────────────────────────────────────────

    // Fetch expected standings from preset endpoint
    const metaRes = await page.request.get("/api/e2e/tournament-run");
    expect(metaRes.ok()).toBeTruthy();
    const meta: {
      groups: Record<string, { expectedStandings: string[] }>;
      totalGoals: number;
    } = await metaRes.json();

    expect(meta.totalGoals).toBe(144);

    const groupA = meta.groups["A"].expectedStandings;
    const groupB = meta.groups["B"].expectedStandings;

    // Admin: Group A correct, Group B correct
    const adminStandingsRes = await page.request.post(`/api/groups/${roomId}/standings`, {
      data: {
        predictions: [
          {
            wcGroup: "A",
            position1: groupA[0],
            position2: groupA[1],
            position3: groupA[2],
            position4: groupA[3],
          },
          {
            wcGroup: "B",
            position1: groupB[0],
            position2: groupB[1],
            position3: groupB[2],
            position4: groupB[3],
          },
        ],
      },
    });
    expect(adminStandingsRes.ok()).toBeTruthy();

    // Member: Group A wrong (top 2 swapped), Group B correct
    const memberStandingsRes = await page2.request.post(`/api/groups/${roomId}/standings`, {
      data: {
        predictions: [
          {
            wcGroup: "A",
            position1: groupA[1], // swapped — wrong
            position2: groupA[0], // swapped — wrong
            position3: groupA[2],
            position4: groupA[3],
          },
          {
            wcGroup: "B",
            position1: groupB[0],
            position2: groupB[1],
            position3: groupB[2],
            position4: groupB[3],
          },
        ],
      },
    });
    expect(memberStandingsRes.ok()).toBeTruthy();

    // ── 5. Phase 1: group stage simulation ───────────────────────────────────

    const phase1Res = await page.request.post("/api/e2e/tournament-run", {
      data: { roomId, phase: 1 },
    });
    expect(phase1Res.ok()).toBeTruthy();

    // Room should now be in ko_betting
    const roomRes = await page.request.get(`/api/groups/${roomId}`);
    const roomData: { status: string } = await roomRes.json();
    expect(roomData.status).toBe("ko_betting");

    // Leaderboard: admin earned from Group A (sole winner) + half of Group B
    //              member earned half of Group B
    const lb1Res = await page.request.get(`/api/groups/${roomId}/leaderboard`);
    const lb1: { name: string; groupStage: number; totalEarned: number }[] = await lb1Res.json();
    const adminEntry1 = lb1.find((e) => e.name === "Admin");
    const memberEntry1 = lb1.find((e) => e.name === "Member");

    expect(adminEntry1?.groupStage).toBeGreaterThan(0);
    expect(memberEntry1?.groupStage).toBeGreaterThan(0);
    // Admin should have earned more than member (admin won Group A solo + half B; member only half B)
    expect(adminEntry1!.groupStage).toBeGreaterThan(memberEntry1!.groupStage);

    // ── 6. KO predictions ────────────────────────────────────────────────────

    // Get all KO match IDs (R32 is now populated after phase 1)
    const koMatchesRes = await page.request.get(`/api/groups/${roomId}/knockout`);
    expect(koMatchesRes.ok()).toBeTruthy();
    const koMatches: { matchId: string }[] = await koMatchesRes.json();
    expect(koMatches.length).toBeGreaterThan(0);

    // Admin: home wins (2-0) — correct with preset
    const adminKORes = await page.request.post(`/api/groups/${roomId}/knockout`, {
      data: {
        predictions: koMatches.map((m) => ({ matchId: m.matchId, homeScore: 2, awayScore: 0 })),
      },
    });
    expect(adminKORes.ok()).toBeTruthy();

    // Member: away wins (0-2) — wrong with preset
    const memberKORes = await page2.request.post(`/api/groups/${roomId}/knockout`, {
      data: {
        predictions: koMatches.map((m) => ({ matchId: m.matchId, homeScore: 0, awayScore: 2 })),
      },
    });
    expect(memberKORes.ok()).toBeTruthy();

    // ── 7. Phase 2: KO stage simulation ──────────────────────────────────────

    const phase2Res = await page.request.post("/api/e2e/tournament-run", {
      data: { roomId, phase: 2 },
    });
    expect(phase2Res.ok()).toBeTruthy();

    // Leaderboard: admin earned KO prizes; member earned nothing from KO
    const lb2Res = await page.request.get(`/api/groups/${roomId}/leaderboard`);
    const lb2: { name: string; groupStage: number; knockout: number; totalEarned: number }[] =
      await lb2Res.json();
    const adminEntry2 = lb2.find((e) => e.name === "Admin");
    const memberEntry2 = lb2.find((e) => e.name === "Member");

    expect(adminEntry2?.knockout).toBeGreaterThan(0);
    expect(memberEntry2?.knockout).toBe(0);
    // Admin's total earnings exceed member's
    expect(adminEntry2!.totalEarned).toBeGreaterThan(memberEntry2!.totalEarned);

    // ── 8. Settle Uber Pot bets ───────────────────────────────────────────────

    // Settle "Total goals" → admin's entry (144) wins
    const settleTotalGoalsRes = await page.request.patch(`/api/groups/${roomId}/sidebets`, {
      data: { sideBetId: totalGoalsBetId, winnerEntryId: adminTotalGoalsEntryId },
    });
    expect(settleTotalGoalsRes.ok()).toBeTruthy();
    const settled1 = await settleTotalGoalsRes.json();
    expect(settled1.status).toBe("settled");

    // Settle "Top scorer" → member's entry wins
    const settleTopScorerRes = await page.request.patch(`/api/groups/${roomId}/sidebets`, {
      data: { sideBetId: topScorerBetId, winnerEntryId: memberTopScorerEntryId },
    });
    expect(settleTopScorerRes.ok()).toBeTruthy();
    const settled2 = await settleTopScorerRes.json();
    expect(settled2.status).toBe("settled");

    // After settlement, leaderboard shows sideBets earnings
    const lb3Res = await page.request.get(`/api/groups/${roomId}/leaderboard`);
    const lb3: { name: string; sideBets: number; totalEarned: number }[] = await lb3Res.json();
    const adminEntry3 = lb3.find((e) => e.name === "Admin");
    const memberEntry3 = lb3.find((e) => e.name === "Member");

    // Both should have sideBet earnings (each won one bet)
    expect(adminEntry3?.sideBets).toBeGreaterThan(0);
    expect(memberEntry3?.sideBets).toBeGreaterThan(0);

    // ── 9. Close group ────────────────────────────────────────────────────────

    // Transition room to finished
    const closeRes = await page.request.patch(`/api/admin/groups/${roomId}`, {
      data: { status: "finished" },
    });
    expect(closeRes.ok()).toBeTruthy();

    // UI: group detail shows finished status
    await page.goto(`/groups/${roomId}`);
    await expect(page.getByText(/finished/i).first()).toBeVisible({ timeout: 5_000 });

    await ctx2.close();
  });
});
