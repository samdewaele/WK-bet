/**
 * Full betting journey — complete lifecycle test
 *
 * Preset simulation: home team always wins 2-0 in every match.
 * Group standings (deterministic): first-listed team > second > third > fourth.
 *   Group A: USA > Panama > Honduras > Morocco
 *   Group B: Argentina > Chile > Peru > Australia  (etc.)
 * Total group goals: 72 matches × 2 = 144.
 *
 * Group prediction variety (all 12 groups, both players):
 *   Group A  — Admin all-correct (×1.0), Member wrong (×0)        → Admin earns solo
 *   Group B  — Both all-correct  (×1.0)                           → Prize split
 *   Group C  — Admin wrong (×0),  Member all-correct (×1.0)       → Member earns solo
 *   Group D  — Both top-2-correct (×0.75)                         → Partial prize split
 *   Groups E-L — Both wrong (×0)                                  → All 8 prizes → Uber Pot
 *
 * KO prediction variety (32 matches, split into thirds):
 *   First ~10  — Admin wrong winner (0-2), Member exact (2-0)   → Member earns (10 R32 × 0.125 = 1.25)
 *   Middle ~10 — Admin exact (2-0),        Member wrong (0-2)   → Admin earns (6 R32 + 4 R16 = 1.75)
 *   Last  ~12  — Both wrong winner (0-1)                        → Both earn nothing → Uber Pot
 *
 * Uber Pot bets:
 *   "Total goals in group stage" — admin answers "144" (correct), member "999" (wrong)
 *   "Top scorer" (member proposes, admin accepts) — admin "Mbappe", member "Haaland"
 *   Admin settles "Total goals" → admin's entry wins
 *   Admin settles "Top scorer" → member's entry wins
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

type StandingPred = {
  wcGroup: string;
  position1: string;
  position2: string;
  position3: string;
  position4: string;
};

/** Build a group standing prediction from expected standings + an accuracy mode. */
function makePred(
  wcGroup: string,
  standings: string[],
  mode: "correct" | "wrong" | "top2"
): StandingPred {
  const [p1, p2, p3, p4] = standings;
  if (mode === "correct") return { wcGroup, position1: p1, position2: p2, position3: p3, position4: p4 };
  if (mode === "top2")    return { wcGroup, position1: p1, position2: p2, position3: p4, position4: p3 };
  // wrong: swap top-2 so no multiplier credit applies
  return { wcGroup, position1: p2, position2: p1, position3: p3, position4: p4 };
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

    // Admin accepts the proposal → status open
    const acceptRes = await page.request.patch(`/api/groups/${roomId}/sidebets`, {
      data: { sideBetId: topScorerBetId, action: "accept" },
    });
    expect(acceptRes.ok()).toBeTruthy();

    // UI: both bets appear on the predictions tab
    await page.goto(`/groups/${roomId}?tab=predictions`);
    await expect(page.getByText("Total goals in group stage")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Top scorer")).toBeVisible({ timeout: 5_000 });

    // ── 3. Submit Uber Pot answers (both players, both bets) ──────────────────

    const adminTotalGoalsEntryRes = await page.request.post(
      `/api/groups/${roomId}/sidebets/${totalGoalsBetId}/entries`,
      { data: { answer: "144" } }
    );
    expect(adminTotalGoalsEntryRes.ok()).toBeTruthy();
    const { id: adminTotalGoalsEntryId } = await adminTotalGoalsEntryRes.json();

    await page2.request.post(
      `/api/groups/${roomId}/sidebets/${totalGoalsBetId}/entries`,
      { data: { answer: "999" } }
    );

    await page.request.post(
      `/api/groups/${roomId}/sidebets/${topScorerBetId}/entries`,
      { data: { answer: "Mbappe" } }
    );

    const memberTopScorerEntryRes = await page2.request.post(
      `/api/groups/${roomId}/sidebets/${topScorerBetId}/entries`,
      { data: { answer: "Haaland" } }
    );
    expect(memberTopScorerEntryRes.ok()).toBeTruthy();
    const { id: memberTopScorerEntryId } = await memberTopScorerEntryRes.json();

    // ── 4. Group standing predictions (ALL 12 groups, both players) ───────────

    // Fetch expected standings from preset endpoint
    const metaRes = await page.request.get("/api/e2e/tournament-run");
    expect(metaRes.ok()).toBeTruthy();
    const meta: {
      groups: Record<string, { expectedStandings: string[] }>;
      totalGoals: number;
    } = await metaRes.json();

    expect(meta.totalGoals).toBe(144);

    const gs = meta.groups; // gs["A"].expectedStandings = [1st, 2nd, 3rd, 4th] team IDs

    /**
     * Prediction matrix — 4 distinct payout scenarios across 12 groups:
     *
     *  Group A  Admin=correct(1.0)  Member=wrong(0)      → Admin earns solo
     *  Group B  Admin=correct(1.0)  Member=correct(1.0)  → Split prize
     *  Group C  Admin=wrong(0)      Member=correct(1.0)  → Member earns solo
     *  Group D  Admin=top2(0.75)    Member=top2(0.75)    → Split partial prize
     *  E–L      Both=wrong(0)                            → Prize → Uber Pot
     */
    const adminPreds: StandingPred[] = [
      makePred("A", gs["A"].expectedStandings, "correct"),
      makePred("B", gs["B"].expectedStandings, "correct"),
      makePred("C", gs["C"].expectedStandings, "wrong"),
      makePred("D", gs["D"].expectedStandings, "top2"),
      ...["E", "F", "G", "H", "I", "J", "K", "L"].map((g) =>
        makePred(g, gs[g].expectedStandings, "wrong")
      ),
    ];

    const memberPreds: StandingPred[] = [
      makePred("A", gs["A"].expectedStandings, "wrong"),
      makePred("B", gs["B"].expectedStandings, "correct"),
      makePred("C", gs["C"].expectedStandings, "correct"),
      makePred("D", gs["D"].expectedStandings, "top2"),
      ...["E", "F", "G", "H", "I", "J", "K", "L"].map((g) =>
        makePred(g, gs[g].expectedStandings, "wrong")
      ),
    ];

    const adminStandingsRes = await page.request.post(`/api/groups/${roomId}/standings`, {
      data: { predictions: adminPreds },
    });
    expect(adminStandingsRes.ok()).toBeTruthy();

    const memberStandingsRes = await page2.request.post(`/api/groups/${roomId}/standings`, {
      data: { predictions: memberPreds },
    });
    expect(memberStandingsRes.ok()).toBeTruthy();

    // ── 5. Phase 1: group stage simulation ───────────────────────────────────

    const phase1Res = await page.request.post("/api/e2e/tournament-run", {
      data: { roomId, phase: 1 },
    });
    expect(phase1Res.ok()).toBeTruthy();

    // API: room is now in ko_betting
    const roomRes1 = await page.request.get(`/api/groups/${roomId}`);
    expect((await roomRes1.json()).status).toBe("ko_betting");

    // UI: predictions tab shows "Actual" standings column (only visible after tournament starts)
    await page.goto(`/groups/${roomId}?tab=predictions`);
    await expect(page.getByText("Actual").first()).toBeVisible({ timeout: 8_000 });

    // UI: standings tab shows leaderboard with earned amounts
    await page.goto(`/groups/${roomId}?tab=standings`);
    await expect(page.getByRole("columnheader", { name: "Player" })).toBeVisible({ timeout: 8_000 }); // table loaded
    await expect(page.getByText(/€[1-9]/).first()).toBeVisible(); // at least one non-zero €

    // API: admin earned from group stage; member also earned (Groups B, C, D)
    const lb1: { name: string; groupStage: number }[] =
      await (await page.request.get(`/api/groups/${roomId}/leaderboard`)).json();
    expect(lb1.find((e) => e.name === "Admin")?.groupStage).toBeGreaterThan(0);
    expect(lb1.find((e) => e.name === "Member")?.groupStage).toBeGreaterThan(0);

    // ── 6. KO predictions (both players, all 32 matches, three-way variety) ───

    // Get all KO match IDs (R32 bracket now populated after phase 1)
    const koMatchesRes = await page.request.get(`/api/groups/${roomId}/knockout`);
    expect(koMatchesRes.ok()).toBeTruthy();
    const koMatches: { matchId: string }[] = await koMatchesRes.json();
    expect(koMatches.length).toBeGreaterThan(0);

    const third = Math.floor(koMatches.length / 3);

    /**
     * KO prediction matrix (ordered by kickoff → R32 first, then R16, QF, SF, 3rd, Final):
     *
     *  Matches 0…third-1   Admin wrong winner (0-2),  Member exact (2-0)       → Member earns (small R32 prizes)
     *  Matches third…2t-1  Admin exact (2-0),          Member wrong (0-2)      → Admin earns (larger R32+R16 prizes)
     *  Matches 2t…end      Both wrong winner (0-1)    → prize → Uber Pot
     *
     * Only the top-scoring tier wins per match. Admin's 1.75 > Member's 1.25.
     */
    const adminKOPreds = koMatches.map((m, i) => {
      if (i < third)         return { matchId: m.matchId, homeScore: 0, awayScore: 2 }; // wrong winner
      if (i < 2 * third)     return { matchId: m.matchId, homeScore: 2, awayScore: 0 }; // exact
      return                        { matchId: m.matchId, homeScore: 0, awayScore: 1 }; // wrong winner
    });

    const memberKOPreds = koMatches.map((m, i) => {
      if (i < third)         return { matchId: m.matchId, homeScore: 2, awayScore: 0 }; // exact
      if (i < 2 * third)     return { matchId: m.matchId, homeScore: 0, awayScore: 2 }; // wrong winner
      return                        { matchId: m.matchId, homeScore: 0, awayScore: 2 }; // wrong winner
    });

    const adminKORes = await page.request.post(`/api/groups/${roomId}/knockout`, {
      data: { predictions: adminKOPreds },
    });
    expect(adminKORes.ok()).toBeTruthy();

    const memberKORes = await page2.request.post(`/api/groups/${roomId}/knockout`, {
      data: { predictions: memberKOPreds },
    });
    expect(memberKORes.ok()).toBeTruthy();

    // ── 7. Phase 2: KO stage simulation ──────────────────────────────────────

    const phase2Res = await page.request.post("/api/e2e/tournament-run", {
      data: { roomId, phase: 2 },
    });
    expect(phase2Res.ok()).toBeTruthy();

    // UI: predictions tab shows actual KO results inline with user's prediction
    await page.goto(`/groups/${roomId}?tab=predictions`);
    await expect(page.getByText(/your pick:/i).first()).toBeVisible({ timeout: 8_000 });

    // UI: standings tab shows KO earnings in leaderboard
    await page.goto(`/groups/${roomId}?tab=standings`);
    await expect(page.getByRole("columnheader", { name: "Player" })).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(/€[1-9]/).first()).toBeVisible();

    // API: both admin and member earned from KO; admin earned more
    const lb2: { name: string; knockout: number; totalEarned: number }[] =
      await (await page.request.get(`/api/groups/${roomId}/leaderboard`)).json();
    const adminEntry2 = lb2.find((e) => e.name === "Admin")!;
    const memberEntry2 = lb2.find((e) => e.name === "Member")!;

    expect(adminEntry2.knockout).toBeGreaterThan(0);
    expect(memberEntry2.knockout).toBeGreaterThan(0); // member earned from the middle third
    expect(adminEntry2.knockout).toBeGreaterThan(memberEntry2.knockout);
    expect(adminEntry2.totalEarned).toBeGreaterThan(memberEntry2.totalEarned);

    // ── 8. Settle Uber Pot bets ───────────────────────────────────────────────

    // Settle "Total goals" → admin's "144" entry wins
    const settleTotalGoalsRes = await page.request.patch(`/api/groups/${roomId}/sidebets`, {
      data: { sideBetId: totalGoalsBetId, winnerEntryId: adminTotalGoalsEntryId },
    });
    expect(settleTotalGoalsRes.ok()).toBeTruthy();
    expect((await settleTotalGoalsRes.json()).status).toBe("settled");

    // Settle "Top scorer" → member's "Haaland" entry wins
    const settleTopScorerRes = await page.request.patch(`/api/groups/${roomId}/sidebets`, {
      data: { sideBetId: topScorerBetId, winnerEntryId: memberTopScorerEntryId },
    });
    expect(settleTopScorerRes.ok()).toBeTruthy();
    expect((await settleTopScorerRes.json()).status).toBe("settled");

    // API: both players have sideBet earnings (each won one bet)
    const lb3: { name: string; sideBets: number }[] =
      await (await page.request.get(`/api/groups/${roomId}/leaderboard`)).json();
    expect(lb3.find((e) => e.name === "Admin")?.sideBets).toBeGreaterThan(0);
    expect(lb3.find((e) => e.name === "Member")?.sideBets).toBeGreaterThan(0);

    // ── 9. Close group ────────────────────────────────────────────────────────

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
