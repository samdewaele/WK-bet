import { db } from "@/lib/db";
import { fetchWCMatches, mapStatus, teamNameMatches } from "@/lib/football-data";
import { calculatePoints, type Round } from "@/lib/points";
import { checkAndSendRoundNotifications, checkAndSendIncompleteReminders } from "@/lib/notifications";
import { computeGroupStandings, populateR32Bracket, populateNextRoundSlot } from "@/lib/ko-seeding";
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
    const [firstGroupKickoff, firstKOKickoff] =
      await Promise.all([
        db.match.findFirst({ where: { round: "Group" }, orderBy: { kickoff: "asc" }, select: { kickoff: true } }),
        db.match.findFirst({ where: { round: { in: ["R32", "R16", "QF", "SF", "3rd", "Final"] }, kickoff: { lte: new Date() } }, orderBy: { kickoff: "asc" }, select: { kickoff: true } }),
      ]);

    const now = new Date();
    const groupStarted = firstGroupKickoff && now >= firstGroupKickoff.kickoff;
    // Use the live API response as the authoritative source for all stage
    // transitions — the DB Match table can contain stale simulation scores
    // that would otherwise produce false positives.
    const apiGroupMatches = apiMatches.filter((m) => m.stage === "GROUP_STAGE");
    const allGroupDone = apiGroupMatches.length >= 72 && apiGroupMatches.every((m) => m.status === "FINISHED");
    const koStarted = !!firstKOKickoff;
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

  const actionable = apiMatches.filter(
    (m) =>
      m.status === "FINISHED" ||
      ["IN_PLAY", "PAUSED", "HALFTIME"].includes(m.status)
  );

  // ── Stale reset pass ──────────────────────────────────────────────────────
  // The actionable filter only covers live/finished API matches, so any DB
  // match with fake sim scores that the API shows as SCHEDULED would linger
  // forever — polluting Recent Results, group standings, and the scoring loop.
  // This pass corrects that on every sync cycle that has valid API data.
  if (hasReliableApiData) {
    const staleMatches = await db.match.findMany({
      where: {
        OR: [
          { status: { not: "scheduled" } },
          { homeScore: { not: null } },
          { awayScore: { not: null } },
        ],
      },
      select: {
        id: true, fdMatchId: true, status: true, homeScore: true, awayScore: true, kickoff: true,
        homeTeam: { select: { fdId: true, name: true } },
        awayTeam: { select: { fdId: true, name: true } },
      },
    });

    for (const stale of staleMatches) {
      // The DB query above should have excluded clean rows, but guard defensively
      // so a test mock that bypasses the WHERE clause doesn't trigger spurious resets.
      if (stale.status === "scheduled" && stale.homeScore === null && stale.awayScore === null) continue;

      const apiCounterpart = apiMatches.find((api) => findDbMatch(stale, api.id, api.homeTeam, api.awayTeam, new Date(api.utcDate).getTime()) !== null);

      const shouldReset =
        // API says the match hasn't happened yet — clear any stale score
        (apiCounterpart && ["SCHEDULED", "TIMED"].includes(apiCounterpart.status)) ||
        // No API counterpart at all — score can't be a real result (old sim data
        // for a KO slot whose real teams are still TBD, or a match that name-
        // matching can't find; either way we cannot trust it)
        !apiCounterpart;

      if (shouldReset) {
        await db.match.update({
          where: { id: stale.id },
          data: { status: "scheduled", homeScore: null, awayScore: null },
        });
        console.log(
          `[sync] Reset stale match ${stale.id} (was: ${stale.status}) — ` +
          (apiCounterpart ? "API reports SCHEDULED" : "no API counterpart (likely old sim data)")
        );
      }
    }
  }

  const [notificationsSent, remindersSent] = await Promise.all([
    checkAndSendRoundNotifications(),
    checkAndSendIncompleteReminders(),
  ]);

  if (actionable.length === 0) {
    return { updated: 0, predictionsScored: 0, notificationsSent, remindersSent, message: "No live or finished matches yet" };
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

    let matchOrientation: "normal" | "reversed" | null = null;
    const dbMatch = dbMatches.find((m) => {
      matchOrientation = findDbMatch(m, api.id, api.homeTeam, api.awayTeam, apiKickoff);
      return matchOrientation !== null;
    });

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

  // Score / seed work runs only when matches were actually updated.
  if (updated > 0) {
    // Score completed groups + progressively drop their qualifiers into R32.
    await scoreAndAdvanceCompletedGroups().catch((err) =>
      console.error("[sync] group scoring failed:", err)
    );

    // Once all groups are done, run the full seeding to fill the best-third
    // slots that progressive per-group fill leaves blank.
    const apiGroupMatchesDone = apiMatches.filter((m) => m.stage === "GROUP_STAGE");
    const allGroupMatchesDone = apiGroupMatchesDone.length >= 72 && apiGroupMatchesDone.every((m) => m.status === "FINISHED");
    const r32FullyPopulated = await db.match.count({
      where: { round: "R32", homeTeamId: { not: null }, awayTeamId: { not: null } },
    });
    if (allGroupMatchesDone && r32FullyPopulated < 16) {
      const standings = await computeGroupStandings();
      await populateR32Bracket(standings).catch((err) =>
        console.error("[sync] R32 seeding failed:", err)
      );
    }
  }

  return {
    updated,
    predictionsScored,
    notificationsSent,
    remindersSent,
    message: `Updated ${updated} match${updated !== 1 ? "es" : ""}, scored ${predictionsScored} prediction${predictionsScored !== 1 ? "s" : ""}`,
  };
}
