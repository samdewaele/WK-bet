import { NextResponse } from "next/server";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { fetchWCMatches, mapStatus } from "@/lib/football-data";
import { calculatePoints, type Round } from "@/lib/points";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let apiMatches;
  try {
    apiMatches = await fetchWCMatches();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch from football-data.org" },
      { status: 502 }
    );
  }

  // Only process live or finished matches — scheduled ones have nothing to update
  const actionable = apiMatches.filter(
    (m) => m.status === "FINISHED" || ["IN_PLAY", "PAUSED", "HALFTIME"].includes(m.status)
  );

  if (actionable.length === 0) {
    return NextResponse.json({ updated: 0, predictionsScored: 0, message: "No live or finished matches yet" });
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

    // Match by kickoff time (±10 min tolerance) + home team name
    const dbMatch = dbMatches.find((m) => {
      const kickoffDiff = Math.abs(new Date(m.kickoff).getTime() - apiKickoff);
      const kickoffMatch = kickoffDiff < 10 * 60 * 1000;
      if (!kickoffMatch) return false;
      if (!m.homeTeam) return true; // KO match with TBD teams — match on kickoff alone
      return (
        m.homeTeam.name.toLowerCase() === api.homeTeam.name.toLowerCase() ||
        m.homeTeam.name.toLowerCase().includes(api.homeTeam.shortName.toLowerCase())
      );
    });

    if (!dbMatch) continue;

    // Skip if nothing changed
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

    // Score predictions when a match transitions to finished with valid scores
    if (!wasFinished && nowFinished && apiHome !== null && apiAway !== null) {
      const round = dbMatch.round as Round;
      const updates = dbMatch.predictions.map((pred) => {
        const points = calculatePoints(round, pred.homeScore, pred.awayScore, apiHome, apiAway);
        return db.prediction.update({
          where: { id: pred.id },
          data: { points },
        });
      });
      await Promise.all(updates);
      predictionsScored += dbMatch.predictions.length;
    }
  }

  return NextResponse.json({
    updated,
    predictionsScored,
    message: `Updated ${updated} match${updated !== 1 ? "es" : ""}, scored ${predictionsScored} prediction${predictionsScored !== 1 ? "s" : ""}`,
  });
}
