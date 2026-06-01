import { db } from "@/lib/db";
import { fetchWCMatches, mapStatus } from "@/lib/football-data";
import { calculatePoints, type Round } from "@/lib/points";
import { checkAndSendRoundNotifications, checkAndSendIncompleteReminders } from "@/lib/notifications";
import { computeGroupStandings, populateR32Bracket, populateNextRoundSlot } from "@/lib/ko-seeding";
import { scoreAndAdvanceCompletedGroups, scoreKOMatchForAllRooms } from "@/lib/scoring";
import type { KORound } from "@/lib/pot";

export type SyncResult = {
  updated: number;
  predictionsScored: number;
  notificationsSent: { round: string; sent: number }[];
  remindersSent: { round: string; sent: number }[];
  message: string;
};

export async function syncMatches(): Promise<SyncResult> {
  const apiMatches = await fetchWCMatches();

  const actionable = apiMatches.filter(
    (m) =>
      m.status === "FINISHED" ||
      ["IN_PLAY", "PAUSED", "HALFTIME"].includes(m.status)
  );

  if (actionable.length === 0) {
    return { updated: 0, predictionsScored: 0, notificationsSent: [], remindersSent: [], message: "No live or finished matches yet" };
  }

  const dbMatches = await db.match.findMany({
    include: { homeTeam: true, awayTeam: true, predictions: true },
  });

  let updated = 0;
  let predictionsScored = 0;

  for (const api of actionable) {
    const apiKickoff = new Date(api.utcDate).getTime();
    const apiStatus = mapStatus(api.status);
    const apiHome = api.score.fullTime.home;
    const apiAway = api.score.fullTime.away;

    const dbMatch = dbMatches.find((m) => {
      const kickoffDiff = Math.abs(new Date(m.kickoff).getTime() - apiKickoff);
      if (kickoffDiff >= 10 * 60 * 1000) return false;
      if (!m.homeTeam) return true; // KO slot with TBD teams — match on kickoff alone
      return (
        m.homeTeam.name.toLowerCase() === api.homeTeam.name.toLowerCase() ||
        m.homeTeam.name.toLowerCase().includes(api.homeTeam.shortName.toLowerCase())
      );
    });

    if (!dbMatch) continue;

    const unchanged =
      dbMatch.status === apiStatus &&
      dbMatch.homeScore === apiHome &&
      dbMatch.awayScore === apiAway;
    if (unchanged) continue;

    const wasFinished = dbMatch.status === "finished";
    const nowFinished = apiStatus === "finished";

    await db.match.update({
      where: { id: dbMatch.id },
      data: {
        status: apiStatus,
        ...(apiHome !== null && { homeScore: apiHome }),
        ...(apiAway !== null && { awayScore: apiAway }),
      },
    });
    updated++;

    if (!wasFinished && nowFinished && apiHome !== null && apiAway !== null) {
      const round = dbMatch.round as Round;
      await Promise.all(
        dbMatch.predictions.map((pred) => {
          const points = calculatePoints(
            round,
            pred.homeScore,
            pred.awayScore,
            apiHome,
            apiAway
          );
          return db.prediction.update({ where: { id: pred.id }, data: { points } });
        })
      );
      predictionsScored += dbMatch.predictions.length;

      // Propagate KO bracket: populate the next round's team slots
      const KO_ROUND_NAMES = ["R32", "R16", "QF", "SF", "3rd", "Final"];
      if (KO_ROUND_NAMES.includes(dbMatch.round) && dbMatch.matchNumber) {
        const winnerId = apiHome > apiAway
          ? (dbMatch.homeTeam?.id ?? null)
          : (dbMatch.awayTeam?.id ?? null);
        const loserId = apiHome > apiAway
          ? (dbMatch.awayTeam?.id ?? null)
          : (dbMatch.homeTeam?.id ?? null);
        if (winnerId) {
          await populateNextRoundSlot(dbMatch.matchNumber, winnerId, loserId).catch(
            (err) => console.error("[sync] KO bracket progression failed:", err)
          );
        }

        // Score every room's KO predictions for this finished match (live money).
        await scoreKOMatchForAllRooms(dbMatch.id, dbMatch.round as KORound, apiHome, apiAway).catch(
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

    const [finishedGroupCount] = await Promise.all([
      db.match.count({ where: { round: "Group", status: "finished" } }),
    ]);

    // Once all groups are done, run the full seeding to fill the best-third
    // slots that progressive per-group fill leaves blank.
    const r32FullyPopulated = await db.match.count({
      where: { round: "R32", homeTeamId: { not: null }, awayTeamId: { not: null } },
    });
    if (finishedGroupCount === 72 && r32FullyPopulated < 16) {
      const standings = await computeGroupStandings();
      await populateR32Bracket(standings).catch((err) =>
        console.error("[sync] R32 seeding failed:", err)
      );
    }
  }

  // Auto-transition non-simulation rooms — runs every sync so time-based
  // triggers (e.g. ko_betting → ko_active when KO kickoffs arrive) fire even
  // when no match scores changed in this cycle.
  {
    const [finishedGroupCount, firstGroupKickoff, firstKOKickoff, finalFinished] =
      await Promise.all([
        db.match.count({ where: { round: "Group", status: "finished" } }),
        db.match.findFirst({ where: { round: "Group" }, orderBy: { kickoff: "asc" }, select: { kickoff: true } }),
        db.match.findFirst({ where: { round: { in: ["R32", "R16", "QF", "SF", "3rd", "Final"] }, kickoff: { lte: new Date() } }, orderBy: { kickoff: "asc" }, select: { kickoff: true } }),
        db.match.count({ where: { round: "Final", status: "finished" } }),
      ]);

    const now = new Date();
    const groupStarted = firstGroupKickoff && now >= firstGroupKickoff.kickoff;
    const allGroupDone = finishedGroupCount === 72;
    const koStarted = !!firstKOKickoff;
    const tournamentOver = finalFinished > 0;

    const rooms = await db.room.findMany({
      where: { simulationMode: false },
      select: { id: true, status: true },
    });

    for (const room of rooms) {
      let newStatus: string | null = null;

      if ((room.status === "betting" || room.status === "closed") && groupStarted) {
        newStatus = "group_active";
      } else if (room.status === "group_active" && allGroupDone) {
        newStatus = "ko_betting";
      } else if (room.status === "ko_betting" && koStarted) {
        newStatus = "ko_active";
      } else if (room.status === "ko_active" && tournamentOver) {
        // Final whistle → settlement. Admin manually confirms "finished"
        // once every Uber Pot bet has been settled.
        newStatus = "settling";
      }

      if (newStatus) {
        await db.room.update({ where: { id: room.id }, data: { status: newStatus } });
      }
    }
  }

  const [notificationsSent, remindersSent] = await Promise.all([
    checkAndSendRoundNotifications(),
    checkAndSendIncompleteReminders(),
  ]);

  return {
    updated,
    predictionsScored,
    notificationsSent,
    remindersSent,
    message: `Updated ${updated} match${updated !== 1 ? "es" : ""}, scored ${predictionsScored} prediction${predictionsScored !== 1 ? "s" : ""}`,
  };
}
