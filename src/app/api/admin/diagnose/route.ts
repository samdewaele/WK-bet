import { NextResponse } from "next/server";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { fetchWCMatches } from "@/lib/football-data";

/**
 * GET /api/admin/diagnose
 *
 * Shows the mismatch between DB match state and the live API so we can
 * see exactly why scores are wrong without guessing.
 */
export async function GET() {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── 1. DB state ────────────────────────────────────────────────────────────
  const dbMatches = await db.match.findMany({
    where: { round: "Group" },
    include: { homeTeam: true, awayTeam: true },
    orderBy: { kickoff: "asc" },
  });

  const dbSummary = {
    groupMatchesTotal: dbMatches.length,
    withScores: dbMatches.filter((m) => m.homeScore !== null).length,
    finished: dbMatches.filter((m) => m.status === "finished").length,
    scheduled: dbMatches.filter((m) => m.status === "scheduled").length,
    teamsWithFdId: await db.team.count({ where: { fdId: { not: null } } }),
    teamsTotal: await db.team.count(),
    sampleMatches: dbMatches.slice(0, 5).map((m) => ({
      home: m.homeTeam?.name ?? "TBD",
      homeFdId: m.homeTeam?.fdId ?? null,
      away: m.awayTeam?.name ?? "TBD",
      awayFdId: m.awayTeam?.fdId ?? null,
      kickoff: m.kickoff.toISOString(),
      status: m.status,
      score: m.homeScore !== null ? `${m.homeScore}-${m.awayScore}` : null,
    })),
  };

  // ── 2. API state ───────────────────────────────────────────────────────────
  let apiMatches;
  try {
    apiMatches = await fetchWCMatches();
  } catch (e) {
    return NextResponse.json({
      db: dbSummary,
      api: { error: e instanceof Error ? e.message : String(e) },
      matchingCheck: [],
    });
  }

  const apiGroup = apiMatches.filter((m) => m.stage === "GROUP_STAGE");
  const apiFinished = apiGroup.filter((m) => m.status === "FINISHED");

  const apiSummary = {
    groupMatchesTotal: apiGroup.length,
    finished: apiFinished.length,
    sampleFinished: apiFinished.slice(0, 5).map((m) => ({
      homeId: m.homeTeam.id,
      home: m.homeTeam.name,
      homeShort: m.homeTeam.shortName,
      awayId: m.awayTeam.id,
      away: m.awayTeam.name,
      awayShort: m.awayTeam.shortName,
      score: `${m.score.fullTime.home}-${m.score.fullTime.away}`,
      kickoff: m.utcDate,
    })),
  };

  // ── 3. Matching check: for every finished API match, can we find a DB row? ─
  const matchingCheck = apiFinished.slice(0, 15).map((api) => {
    const byFdId = dbMatches.find(
      (m) => m.homeTeam?.fdId === api.homeTeam.id && m.awayTeam?.fdId === api.awayTeam.id
    );

    const byName = !byFdId
      ? dbMatches.find((m) => {
          if (!m.homeTeam || !m.awayTeam) return false;
          const h = m.homeTeam.name.toLowerCase();
          const aw = m.awayTeam.name.toLowerCase();
          const homeOk =
            h === api.homeTeam.name.toLowerCase() ||
            h === api.homeTeam.shortName.toLowerCase() ||
            h === api.homeTeam.tla.toLowerCase() ||
            h.includes(api.homeTeam.shortName.toLowerCase()) ||
            api.homeTeam.name.toLowerCase().includes(h) ||
            api.homeTeam.shortName.toLowerCase().includes(h);
          const awayOk =
            aw === api.awayTeam.name.toLowerCase() ||
            aw === api.awayTeam.shortName.toLowerCase() ||
            aw === api.awayTeam.tla.toLowerCase() ||
            aw.includes(api.awayTeam.shortName.toLowerCase()) ||
            api.awayTeam.name.toLowerCase().includes(aw) ||
            api.awayTeam.shortName.toLowerCase().includes(aw);
          return homeOk && awayOk;
        })
      : undefined;

    const matched = byFdId ?? byName;
    return {
      apiMatch: `${api.homeTeam.name} (${api.homeTeam.id}) vs ${api.awayTeam.name} (${api.awayTeam.id})`,
      realScore: `${api.score.fullTime.home}-${api.score.fullTime.away}`,
      matchedBy: byFdId ? "fdId" : byName ? "name" : "NONE — will be skipped by sync",
      dbScore: matched
        ? (matched.homeScore !== null ? `${matched.homeScore}-${matched.awayScore}` : "null/null (scheduled)")
        : "—",
      dbStatus: matched?.status ?? "—",
    };
  });

  return NextResponse.json({ db: dbSummary, api: apiSummary, matchingCheck });
}
