import { NextResponse } from "next/server";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { fetchWCMatches, teamNameMatches, mapStatus } from "@/lib/football-data";

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
    withFdMatchId: dbMatches.filter((m) => m.fdMatchId !== null).length,
    teamsWithFdId: await db.team.count({ where: { fdId: { not: null } } }),
    teamsTotal: await db.team.count(),
    sampleMatches: dbMatches.slice(0, 5).map((m) => ({
      home: m.homeTeam?.name ?? "TBD",
      homeFdId: m.homeTeam?.fdId ?? null,
      away: m.awayTeam?.name ?? "TBD",
      awayFdId: m.awayTeam?.fdId ?? null,
      fdMatchId: m.fdMatchId ?? null,
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
  // Uses the same teamNameMatches from football-data.ts that the real sync uses.
  const matchingCheck = apiFinished.map((api) => {
    const byMatchId = dbMatches.find((m) => m.fdMatchId === api.id);

    const byFdId = !byMatchId
      ? dbMatches.find(
          (m) => m.homeTeam?.fdId === api.homeTeam.id && m.awayTeam?.fdId === api.awayTeam.id
        )
      : undefined;

    const byName = !byMatchId && !byFdId
      ? dbMatches.find((m) => {
          if (!m.homeTeam || !m.awayTeam) return false;
          return teamNameMatches(m.homeTeam.name, api.homeTeam) && teamNameMatches(m.awayTeam.name, api.awayTeam);
        })
      : undefined;

    const matched = byMatchId ?? byFdId ?? byName;
    return {
      apiMatch: `${api.homeTeam.name} (id:${api.id}) vs ${api.awayTeam.name}`,
      apiGroup: api.group,
      realScore: `${api.score.fullTime.home}-${api.score.fullTime.away}`,
      matchedBy: byMatchId ? "fdMatchId" : byFdId ? "teamFdId" : byName ? "name" : "NONE — will be skipped by sync",
      dbScore: matched
        ? (matched.homeScore !== null ? `${matched.homeScore}-${matched.awayScore}` : "null/null (scheduled)")
        : "—",
      dbStatus: matched?.status ?? "—",
      dbGroup: matched?.group ?? "—",
      dbHomeTeam: matched?.homeTeam?.name ?? "null",
      dbAwayTeam: matched?.awayTeam?.name ?? "null",
    };
  });

  // ── 4. Live match check ────────────────────────────────────────────────────
  const LIVE_STATUSES = ["IN_PLAY", "PAUSED", "HALFTIME"] as const;
  const apiLive = apiMatches.filter((m) => (LIVE_STATUSES as readonly string[]).includes(m.status));

  const dbLive = await db.match.findMany({
    where: { status: "live" },
    include: { homeTeam: true, awayTeam: true },
    orderBy: { kickoff: "asc" },
  });

  // All DB matches (all rounds) needed to check if a live API match maps to a DB row.
  const allDbMatches = await db.match.findMany({
    include: {
      homeTeam: { select: { id: true, fdId: true, name: true } },
      awayTeam: { select: { id: true, fdId: true, name: true } },
    },
  });

  const liveMatchCheck = apiLive.map((api) => {
    const byMatchId = allDbMatches.find((m) => m.fdMatchId === api.id);
    const byName = !byMatchId
      ? allDbMatches.find((m) => {
          if (!m.homeTeam || !m.awayTeam) return false;
          return (
            teamNameMatches(m.homeTeam.name, api.homeTeam) &&
            teamNameMatches(m.awayTeam.name, api.awayTeam)
          );
        })
      : undefined;
    const matched = byMatchId ?? byName;
    const liveScore = api.score.fullTime;
    return {
      apiMatch: `${api.homeTeam.name} vs ${api.awayTeam.name}`,
      apiId: api.id,
      apiStatus: api.status,
      apiMappedStatus: mapStatus(api.status),
      apiScore: liveScore.home !== null ? `${liveScore.home}-${liveScore.away}` : "in progress (null)",
      apiKickoff: api.utcDate,
      matchedBy: byMatchId ? "fdMatchId" : byName ? "name" : "NONE — will be skipped by sync",
      dbStatus: matched?.status ?? "—",
      dbScore: matched
        ? matched.homeScore !== null
          ? `${matched.homeScore}-${matched.awayScore}`
          : "null/null"
        : "—",
      dbRound: matched?.round ?? "—",
      dbId: matched?.id ?? "—",
    };
  });

  const liveSummary = {
    apiLiveCount: apiLive.length,
    dbLiveCount: dbLive.length,
    dbLiveMatches: dbLive.map((m) => ({
      id: m.id,
      home: m.homeTeam?.name ?? "TBD",
      away: m.awayTeam?.name ?? "TBD",
      score: m.homeScore !== null ? `${m.homeScore}-${m.awayScore}` : "null/null",
      kickoff: m.kickoff.toISOString(),
      round: m.round,
    })),
    liveMatchCheck,
  };

  return NextResponse.json({ db: dbSummary, api: apiSummary, matchingCheck, live: liveSummary });
}
