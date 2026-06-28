import { db } from "@/lib/db";
import { fetchWCMatches, mapStatus, teamNameMatches } from "@/lib/football-data";
import { calculatePoints, type Round } from "@/lib/points";
import { checkAndSendRoundNotifications, checkAndSendIncompleteReminders } from "@/lib/notifications";
import { computeGroupStandings, populateR32Bracket, populateR32FromApi, populateNextRoundSlot } from "@/lib/ko-seeding";
import { scoreAndAdvanceCompletedGroups, scoreKOMatchForAllRooms } from "@/lib/scoring";
import type { KORound } from "@/lib/pot";

import type { FDTeam } from "@/lib/football-data";

type DbMatchCandidate = {
  fdMatchId: number | null;
  homeTeam: { fdId: number | null; name: string } | null;
  awayTeam: { fdId: number | null; name: string } | null;
  kickoff: Date;
};

function teamMatches(dbName: string, api: FDTeam): boolean {
  return teamNameMatches(dbName, api);
}

/**
 * Match a DB row to an API match.
 * Primary:   football-data.org match ID (set by seed on every deploy).
 * Secondary: football-data.org team IDs (set by seed on every deploy).
 * Tertiary:  multi-field name matching covering localisation variants.
 * TBD KO placeholders (no teams yet): kickoff proximity within 24 hours.
 */
/**
 * Returns "normal" if the DB match corresponds to the API match with teams in
 * the same slot order, "reversed" if home/away are swapped in the DB vs the API,
 * or null if no correspondence was found.
 * Callers must swap homeScore/awayScore when the result is "reversed".
 */
function findDbMatch(
  m: DbMatchCandidate,
  apiMatchId: number,
  apiHome: FDTeam,
  apiAway: FDTeam,
  apiKickoffMs: number
): "normal" | "reversed" | null {
  if (m.fdMatchId !== null && m.fdMatchId !== undefined) {
    return m.fdMatchId === apiMatchId ? "normal" : null;
  }
  if (m.homeTeam && m.awayTeam) {
    if (m.homeTeam.fdId && m.awayTeam.fdId) {
      if (m.homeTeam.fdId === apiHome.id && m.awayTeam.fdId === apiAway.id) return "normal";
      if (m.homeTeam.fdId === apiAway.id && m.awayTeam.fdId === apiHome.id) return "reversed";
      return null;
    }
    if (teamMatches(m.homeTeam.name, apiHome) && teamMatches(m.awayTeam.name, apiAway)) return "normal";
    if (teamMatches(m.homeTeam.name, apiAway) && teamMatches(m.awayTeam.name, apiHome)) return "reversed";
    return null;
  }
  return Math.abs(m.kickoff.getTime() - apiKickoffMs) < 24 * 60 * 60 * 1000 ? "normal" : null;
}

export type SyncResult = {
  updated: number;
  predictionsScored: number;
  hasLiveMatches: boolean;
  notificationsSent: { round: string; sent: number }[];
  remindersSent: { round: string; sent: number }[];
  message: string;
};

export async function syncMatches(): Promise<SyncResult> {
  const apiMatches = await fetchWCMatches();

  // Computed once, used in both the auto-transition block and the stale reset pass.
  const hasReliableApiData = apiMatches.length > 0;

  // Auto-transition runs unconditionally on every sync — time-based triggers
  // like ko_betting → ko_active must fire even when no API matches are
  // live/finished (the gap between group stage completion and KO kickoff).
  {
    const firstGroupKickoff = await db.match.findFirst({
      where: { round: "Group" },
      orderBy: { kickoff: "asc" },
      select: { kickoff: true },
    });

    const now = new Date();
    const groupStarted = firstGroupKickoff && now >= firstGroupKickoff.kickoff;
    // Use the live API response as the authoritative source for all stage
    // transitions — the DB Match table can contain stale simulation scores
    // that would otherwise produce false positives.
    const apiGroupMatches = apiMatches.filter((m) => m.stage === "GROUP_STAGE");
    const allGroupDone = apiGroupMatches.length >= 72 && apiGroupMatches.every((m) => m.status === "FINISHED");
    // KO is underway only once the group stage is fully complete (API-authoritative)
    // AND the API shows a knockout-stage match that has kicked off or is live/finished.
    // Both gates are derived from the API — never from DB kickoff times — so a stale
    // or corrupted KO placeholder kickoff can never force the room into ko_active
    // while the group stage is still running.
    const KO_API_STAGES = ["LAST_32", "LAST_16", "QUARTER_FINALS", "SEMI_FINALS", "THIRD_PLACE", "FINAL"];
    const koStarted =
      allGroupDone &&
      apiMatches.some(
        (m) =>
          KO_API_STAGES.includes(m.stage) &&
          (["IN_PLAY", "PAUSED", "HALFTIME", "FINISHED"].includes(m.status) || now >= new Date(m.utcDate))
      );
    // Tournament over only when the API confirms the Final is FINISHED.
    // Reading from db.match would trigger on old simulation data still in the
    // Match table from runs before the SimResult migration.
    const apiFinalMatches = apiMatches.filter((m) => m.stage === "FINAL");
    const tournamentOver = apiFinalMatches.length > 0 && apiFinalMatches.every((m) => m.status === "FINISHED");

    // Derive the single correct status from real tournament state.
    // This overwrites whatever the room currently holds, so a room that
    // jumped to ko_betting (or even settling) by mistake will self-correct.
    // "settling" is included so a room wrongly promoted can revert when the
    // API doesn't confirm the tournament is over. "finished" is excluded —
    // that is a manual admin confirmation and must never be auto-overridden.
    // We skip all updates when the API returned no data (network failure) so
    // a temporary outage can't roll back a legitimately settled room.
    const AUTO_MANAGED = ["betting", "closed", "group_active", "ko_betting", "ko_active", "settling"];
    let correctStatus: string | null = null;
    if (tournamentOver) {
      correctStatus = "settling";
    } else if (koStarted) {
      correctStatus = "ko_active";
    } else if (allGroupDone) {
      correctStatus = "ko_betting";
    } else if (groupStarted) {
      correctStatus = "group_active";
    }

    const rooms = await db.room.findMany({
      where: { simulationMode: false },
      select: { id: true, status: true },
    });

    for (const room of rooms) {
      if (
        hasReliableApiData &&
        correctStatus &&
        AUTO_MANAGED.includes(room.status) &&
        room.status !== correctStatus
      ) {
        await db.room.update({ where: { id: room.id }, data: { status: correctStatus } });
      }
    }
  }

  const LIVE_STATUSES = ["IN_PLAY", "PAUSED", "HALFTIME"];
  const hasLiveMatches = apiMatches.some((m) => LIVE_STATUSES.includes(m.status));
  const actionable = apiMatches.filter(
    (m) => m.status === "FINISHED" || LIVE_STATUSES.includes(m.status)
  );

  // ── Stale reset pass ──────────────────────────────────────────────────────
  // The actionable filter only covers live/finished API matches, so any DB
  // match with fake sim scores that the API shows as SCHEDULED would linger
  // forever — polluting Recent Results, group standings, and the scoring loop.
  // This pass corrects that on every sync cycle that has valid API data.
  if (hasReliableApiData) {
    const now = new Date();
    const KO_ROUNDS = ["R32", "R16", "QF", "SF", "3rd", "Final"];
    // Sentinel kickoff for a KO placeholder whose real fixture date is unknown.
    // Clearly after the tournament, so it can never look like a started match.
    const KO_TBD_KICKOFF = new Date("2026-12-31T00:00:00.000Z");

    const staleMatches = await db.match.findMany({
      where: {
        OR: [
          { status: { not: "scheduled" } },
          { homeScore: { not: null } },
          { awayScore: { not: null } },
          // Corrupt KO placeholders: a knockout row whose kickoff is already in
          // the past is suspicious — during the group stage the real KO fixtures
          // are still in the future. A past date here was almost certainly left
          // by a mis-matched group result, so re-evaluate and repair it even if
          // the score/status were already cleared by an earlier sync.
          { AND: [{ round: { in: KO_ROUNDS } }, { kickoff: { lt: now } }] },
        ],
      },
      select: {
        id: true, fdMatchId: true, status: true, homeScore: true, awayScore: true, kickoff: true,
        round: true,
        homeTeam: { select: { fdId: true, name: true } },
        awayTeam: { select: { fdId: true, name: true } },
      },
    });

    // Maps DB round names to the API stage string so stale-reset only matches
    // a DB match against API matches from the same stage. Without this, an R16
    // placeholder that happens to share team fdIds with a GROUP_STAGE result
    // would appear to have a valid API counterpart and its wrong score would
    // never be cleared.
    const ROUND_TO_STAGE: Partial<Record<string, string>> = {
      Group: "GROUP_STAGE", R32: "LAST_32", R16: "LAST_16",
      QF: "QUARTER_FINALS", SF: "SEMI_FINALS", "3rd": "THIRD_PLACE", Final: "FINAL",
    };

    for (const stale of staleMatches) {
      const isKO = !!stale.round && stale.round !== "Group";
      const hasStaleScore =
        stale.status !== "scheduled" || stale.homeScore !== null || stale.awayScore !== null;
      const hasPastKickoff = stale.kickoff.getTime() < now.getTime();

      // Nothing to do for a clean row that isn't a KO placeholder with a past date.
      if (!hasStaleScore && !(isKO && hasPastKickoff)) continue;

      const expectedStage = stale.round ? ROUND_TO_STAGE[stale.round] : undefined;
      const apiCounterpart = apiMatches.find((api) => {
        // Only consider API matches from the same tournament stage as the DB row.
        if (expectedStage && api.stage !== expectedStage) return false;
        return findDbMatch(stale, api.id, api.homeTeam, api.awayTeam, new Date(api.utcDate).getTime()) !== null;
      });

      const apiNotStarted = !!apiCounterpart && ["SCHEDULED", "TIMED"].includes(apiCounterpart.status);
      const noCounterpart = !apiCounterpart;

      // Reset a stale score when the API says the match hasn't happened yet, or
      // when there's no API counterpart at all (old sim data / unmatchable row).
      const shouldResetScore = hasStaleScore && (apiNotStarted || noCounterpart);
      // Repair a KO placeholder's kickoff when it's in the past but has no valid
      // same-stage API counterpart — the date is corrupt and must not trip the
      // ko_active transition or any other time-based logic.
      const shouldFixKickoff = isKO && hasPastKickoff && noCounterpart;

      if (!shouldResetScore && !shouldFixKickoff) continue;

      const resetData: Record<string, unknown> = {};
      if (shouldResetScore) {
        resetData.status = "scheduled";
        resetData.homeScore = null;
        resetData.awayScore = null;
      }
      // For KO placeholders, clear team slots so the row no longer attracts
      // group-stage results via team fdId matching.
      if (isKO && (shouldResetScore || shouldFixKickoff)) {
        resetData.homeTeamId = null;
        resetData.awayTeamId = null;
      }
      if (shouldFixKickoff) {
        resetData.kickoff = KO_TBD_KICKOFF;
      } else if (shouldResetScore && isKO && apiCounterpart) {
        // We know the real fixture date — restore it rather than the sentinel.
        resetData.kickoff = new Date(apiCounterpart.utcDate);
      }

      await db.match.update({ where: { id: stale.id }, data: resetData });
      console.log(
        `[sync] Repaired stale match ${stale.id} round=${stale.round} (was: ${stale.status})` +
        (shouldFixKickoff ? " — corrupt KO kickoff cleared" : "") +
        (shouldResetScore ? (apiCounterpart ? " — API reports SCHEDULED" : " — no API counterpart (likely old sim data)") : "")
      );
    }
  }

  const [notificationsSent, remindersSent] = await Promise.all([
    checkAndSendRoundNotifications(),
    checkAndSendIncompleteReminders(),
  ]);

  if (actionable.length === 0) {
    return { updated: 0, predictionsScored: 0, hasLiveMatches, notificationsSent, remindersSent, message: "No live or finished matches yet" };
  }

  const dbMatches = await db.match.findMany({
    include: {
      homeTeam: { select: { id: true, fdId: true, name: true } },
      awayTeam: { select: { id: true, fdId: true, name: true } },
      predictions: true,
    },
    // Also select fdMatchId on the match itself so findDbMatch can use it
    // as the primary key before falling back to team names.
  });

  let updated = 0;
  let predictionsScored = 0;

  for (const api of actionable) {
    const apiKickoff = new Date(api.utcDate).getTime();
    const apiStatus = mapStatus(api.status);
    const apiHome = api.score.fullTime.home;
    const apiAway = api.score.fullTime.away;

    // Pass 1: exact fdMatchId match — avoids being tricked by KO placeholders
    // that share team fdIds with a group-stage result when dbMatches.find()
    // iteration happens to visit the placeholder before the Group row.
    let matchOrientation: "normal" | "reversed" | null = null;
    let dbMatch: (typeof dbMatches)[0] | undefined;
    const byFdMatchId = dbMatches.find((m) => m.fdMatchId === api.id);
    if (byFdMatchId) {
      dbMatch = byFdMatchId;
      matchOrientation = "normal";
    } else {
      // Pass 2: fall back to team/name/kickoff matching only for rows that have
      // no fdMatchId (unrepaired rows). Skip rows with a non-matching fdMatchId —
      // those belong to a different API match.
      for (const m of dbMatches) {
        if (m.fdMatchId !== null) continue;
        const orient = findDbMatch(m, api.id, api.homeTeam, api.awayTeam, apiKickoff);
        if (orient !== null) { dbMatch = m; matchOrientation = orient; break; }
      }
    }

    if (!dbMatch) {
      console.warn(`[sync] No DB match found for API match id=${api.id} (${api.homeTeam.name} vs ${api.awayTeam.name}, status=${api.status}) — skipped`);
      continue;
    }

    // When DB has teams in the opposite slot order from the API, swap the scores
    // so homeScore always corresponds to the DB's homeTeam.
    const storeHome = matchOrientation === "reversed" ? apiAway : apiHome;
    const storeAway = matchOrientation === "reversed" ? apiHome : apiAway;

    const unchanged =
      dbMatch.status === apiStatus &&
      dbMatch.homeScore === storeHome &&
      dbMatch.awayScore === storeAway;
    if (unchanged) continue;

    const wasFinished = dbMatch.status === "finished";
    const nowFinished = apiStatus === "finished";
    // Also rescore if the match was already finished but scores changed — this
    // catches the case where sim data left a "finished" match with wrong scores
    // that the stale reset pass didn't clear (e.g. first sync after a new sim run).
    const scoresChanged = dbMatch.homeScore !== storeHome || dbMatch.awayScore !== storeAway;

    await db.match.update({
      where: { id: dbMatch.id },
      data: {
        status: apiStatus,
        kickoff: new Date(api.utcDate), // sync real kickoff so per-group locks use correct times
        // Sync group letter from API in case it was null or wrong in the DB
        ...(api.group && { group: api.group.replace(/^GROUP_/, "") }),
        ...(storeHome !== null && { homeScore: storeHome }),
        ...(storeAway !== null && { awayScore: storeAway }),
      },
    });
    updated++;

    if (nowFinished && (!wasFinished || scoresChanged) && storeHome !== null && storeAway !== null) {
      const round = dbMatch.round as Round;
      await Promise.all(
        dbMatch.predictions.map((pred) => {
          const points = calculatePoints(
            round,
            pred.homeScore,
            pred.awayScore,
            storeHome,
            storeAway
          );
          return db.prediction.update({ where: { id: pred.id }, data: { points } });
        })
      );
      predictionsScored += dbMatch.predictions.length;

      // Propagate KO bracket: populate the next round's team slots
      const KO_ROUND_NAMES = ["R32", "R16", "QF", "SF", "3rd", "Final"];
      if (KO_ROUND_NAMES.includes(dbMatch.round) && dbMatch.matchNumber) {
        const winnerId = storeHome > storeAway
          ? (dbMatch.homeTeam?.id ?? null)
          : (dbMatch.awayTeam?.id ?? null);
        const loserId = storeHome > storeAway
          ? (dbMatch.awayTeam?.id ?? null)
          : (dbMatch.homeTeam?.id ?? null);
        if (winnerId) {
          await populateNextRoundSlot(dbMatch.matchNumber, winnerId, loserId).catch(
            (err) => console.error("[sync] KO bracket progression failed:", err)
          );
        }

        // Score every room's KO predictions for this finished match (live money).
        await scoreKOMatchForAllRooms(dbMatch.id, dbMatch.round as KORound, storeHome, storeAway).catch(
          (err) => console.error("[sync] KO scoring failed:", err)
        );
      }
    }
  }

  // Score completed groups + progressively drop their qualifiers into R32 —
  // only when matches actually changed (scoring is update-driven).
  if (updated > 0) {
    await scoreAndAdvanceCompletedGroups().catch((err) =>
      console.error("[sync] group scoring failed:", err)
    );
  }

  // R32 bracket seeding runs every reliable sync — NOT gated on `updated` — so
  // it corrects already-populated wrong slots even in cycles where no match
  // changed (e.g. between the group stage finishing and R32 kicking off).
  // populateR32FromApi is idempotent and self-healing.
  if (hasReliableApiData) {
    const apiGroupMatchesDone = apiMatches.filter((m) => m.stage === "GROUP_STAGE");
    const allGroupMatchesDone =
      apiGroupMatchesDone.length >= 72 && apiGroupMatchesDone.every((m) => m.status === "FINISHED");
    if (allGroupMatchesDone) {
      // Prefer FIFA's real R32 draw from football-data (correct third-place
      // teams + fdMatchId binding); fall back to the heuristic only while the
      // bracket is still blank and the API hasn't published LAST_32 teams.
      const apiLast32 = apiMatches.filter(
        (m) => m.stage === "LAST_32" && m.homeTeam?.id != null && m.awayTeam?.id != null,
      );
      if (apiLast32.length >= 16) {
        const standings = await computeGroupStandings();
        await populateR32FromApi(standings, apiLast32).catch((err) =>
          console.error("[sync] R32 API seeding failed:", err)
        );
      } else {
        const r32FullyPopulated = await db.match.count({
          where: { round: "R32", homeTeamId: { not: null }, awayTeamId: { not: null } },
        });
        if (r32FullyPopulated < 16) {
          const standings = await computeGroupStandings();
          await populateR32Bracket(standings).catch((err) =>
            console.error("[sync] R32 seeding failed:", err)
          );
        }
      }
    }
  }

  return {
    updated,
    predictionsScored,
    hasLiveMatches,
    notificationsSent,
    remindersSent,
    message: `Updated ${updated} match${updated !== 1 ? "es" : ""}, scored ${predictionsScored} prediction${predictionsScored !== 1 ? "s" : ""}`,
  };
}
