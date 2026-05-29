import { db } from "@/lib/db";
import { fetchWCMatches, mapStatus } from "@/lib/football-data";
import { calculatePoints, type Round } from "@/lib/points";
import { checkAndSendRoundNotifications, checkAndSendIncompleteReminders } from "@/lib/notifications";
import { computeGroupStandings, populateR32Bracket } from "@/lib/ko-seeding";

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
    }
  }

  // Auto-populate R32 bracket when all 72 group matches are finished
  // and the R32 slots haven't been filled yet.
  if (updated > 0) {
    const [finishedGroupCount, r32WithTeams] = await Promise.all([
      db.match.count({ where: { round: "Group", status: "finished" } }),
      db.match.count({ where: { round: "R32", homeTeamId: { not: null } } }),
    ]);
    if (finishedGroupCount === 72 && r32WithTeams === 0) {
      const standings = await computeGroupStandings();
      await populateR32Bracket(standings).catch((err) =>
        console.error("[sync] R32 seeding failed:", err)
      );
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
