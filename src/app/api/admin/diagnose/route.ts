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
  function normName(s: string): string {
    return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/\s+and\s+/g, " ").replace(/-/g, " ").replace(/[''`]/g, "").replace(/\s+/g, " ").trim();
  }
  const TEAM_ALIASES = new Map<string, string[]>([
    ["Côte d'Ivoire", ["Ivory Coast", "Cote d Ivoire"]],
    ["Congo DR",      ["DR Congo", "DRC", "Congo DRC", "Democratic Republic of Congo"]],
  ]);
  function nameOk(dbName: string, api: { name: string; shortName: string; tla: string }): boolean {
    const h = dbName.toLowerCase();
    const hn = normName(dbName);
    if (h === api.name.toLowerCase() || h === api.shortName.toLowerCase() || h === api.tla.toLowerCase() ||
        h.includes(api.shortName.toLowerCase()) || api.name.toLowerCase().includes(h) ||
        api.shortName.toLowerCase().includes(h) ||
        hn === normName(api.name) || hn === normName(api.shortName)) return true;
    return (TEAM_ALIASES.get(dbName) ?? []).some((alias) => {
      const an = alias.toLowerCase();
      return an === api.name.toLowerCase() || an === api.shortName.toLowerCase() ||
        normName(alias) === normName(api.name) || normName(alias) === normName(api.shortName);
    });
  }

  const matchingCheck = apiFinished.slice(0, 15).map((api) => {
    const byMatchId = dbMatches.find((m) => m.fdMatchId === api.id);

    const byFdId = !byMatchId
      ? dbMatches.find(
          (m) => m.homeTeam?.fdId === api.homeTeam.id && m.awayTeam?.fdId === api.awayTeam.id
        )
      : undefined;

    const byName = !byMatchId && !byFdId
      ? dbMatches.find((m) => {
          if (!m.homeTeam || !m.awayTeam) return false;
          return nameOk(m.homeTeam.name, api.homeTeam) && nameOk(m.awayTeam.name, api.awayTeam);
        })
      : undefined;

    const matched = byMatchId ?? byFdId ?? byName;
    return {
      apiMatch: `${api.homeTeam.name} (id:${api.id}) vs ${api.awayTeam.name}`,
      realScore: `${api.score.fullTime.home}-${api.score.fullTime.away}`,
      matchedBy: byMatchId ? "fdMatchId" : byFdId ? "teamFdId" : byName ? "name" : "NONE — will be skipped by sync",
      dbScore: matched
        ? (matched.homeScore !== null ? `${matched.homeScore}-${matched.awayScore}` : "null/null (scheduled)")
        : "—",
      dbStatus: matched?.status ?? "—",
    };
  });

  return NextResponse.json({ db: dbSummary, api: apiSummary, matchingCheck });
}
