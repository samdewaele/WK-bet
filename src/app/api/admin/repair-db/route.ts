import { NextResponse } from "next/server";
import { auth } from "@auth";
import { db } from "@/lib/db";

/**
 * POST /api/admin/repair-db
 *
 * Backfills fdMatchId on group-stage Match rows and fdId on Team rows
 * from the football-data.org API, without deleting or recreating anything.
 *
 * Run this after reseed-teams or whenever fdMatchId / fdId are missing.
 * Once every match has an fdMatchId the sync job matches by stable ID,
 * so name mismatches (Ivory Coast / Côte d'Ivoire etc.) never matter again.
 */

type ApiTeam = { id: number; name: string; shortName: string; tla: string };
type ApiMatch = {
  id: number;
  utcDate: string;
  stage: string;
  group: string | null;
  homeTeam: ApiTeam;
  awayTeam: ApiTeam;
};

function normName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+and\s+/g, " ")
    .replace(/-/g, " ")
    .replace(/[''`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const TEAM_ALIASES = new Map<string, string[]>([
  ["Côte d'Ivoire", ["Ivory Coast", "Cote d Ivoire", "Cote dIvoire"]],
  ["Congo DR",      ["DR Congo", "DRC", "Congo DRC", "Democratic Republic Congo", "Democratic Republic of Congo"]],
]);

function apiTeamMatches(dbName: string, api: ApiTeam): boolean {
  const dbLower = dbName.toLowerCase();
  const dbNorm = normName(dbName);
  if (
    dbLower === api.name.toLowerCase() ||
    dbLower === api.shortName.toLowerCase() ||
    dbLower === api.tla.toLowerCase() ||
    dbLower.includes(api.shortName.toLowerCase()) ||
    api.name.toLowerCase().includes(dbLower) ||
    api.shortName.toLowerCase().includes(dbLower) ||
    dbNorm === normName(api.name) ||
    dbNorm === normName(api.shortName)
  ) return true;
  const aliases = TEAM_ALIASES.get(dbName) ?? [];
  return aliases.some((alias) => {
    const an = alias.toLowerCase();
    return (
      an === api.name.toLowerCase() ||
      an === api.shortName.toLowerCase() ||
      normName(alias) === normName(api.name) ||
      normName(alias) === normName(api.shortName)
    );
  });
}

export async function POST() {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "FOOTBALL_DATA_API_KEY is not set" }, { status: 502 });
  }

  const resp = await fetch("https://api.football-data.org/v4/competitions/WC/matches", {
    headers: { "X-Auth-Token": apiKey },
  });
  if (!resp.ok) {
    return NextResponse.json({ error: `football-data.org returned ${resp.status}` }, { status: 502 });
  }
  const data = await resp.json();
  const allApiMatches = (data.matches ?? []) as ApiMatch[];
  const apiGroup = allApiMatches.filter((m) => m.stage === "GROUP_STAGE");

  const dbGroup = await db.match.findMany({
    where: { round: "Group" },
    include: { homeTeam: true, awayTeam: true },
  });

  let matchIdsSet = 0;
  let kickoffsFixed = 0;
  let teamIdsSet = 0;
  let unmatched = 0;

  for (const dbm of dbGroup) {
    if (!dbm.homeTeam || !dbm.awayTeam) continue;

    // Try to find the API counterpart
    const apiM = apiGroup.find(
      (a) => apiTeamMatches(dbm.homeTeam!.name, a.homeTeam) && apiTeamMatches(dbm.awayTeam!.name, a.awayTeam)
    );

    if (!apiM) {
      unmatched++;
      continue;
    }

    const updates: Record<string, unknown> = {};
    if (!dbm.fdMatchId) { updates.fdMatchId = apiM.id; matchIdsSet++; }
    const realKickoff = new Date(apiM.utcDate);
    if (dbm.kickoff.getTime() !== realKickoff.getTime()) { updates.kickoff = realKickoff; kickoffsFixed++; }

    if (Object.keys(updates).length > 0) {
      await db.match.update({ where: { id: dbm.id }, data: updates });
    }

    if (!dbm.homeTeam.fdId) {
      await db.team.update({ where: { id: dbm.homeTeam.id }, data: { fdId: apiM.homeTeam.id } });
      teamIdsSet++;
    }
    if (!dbm.awayTeam.fdId) {
      await db.team.update({ where: { id: dbm.awayTeam.id }, data: { fdId: apiM.awayTeam.id } });
      teamIdsSet++;
    }
  }

  return NextResponse.json({
    ok: true,
    matchIdsSet,
    kickoffsFixed,
    teamIdsSet,
    unmatched,
    message: `Set ${matchIdsSet} match IDs, fixed ${kickoffsFixed} kickoffs, set ${teamIdsSet} team IDs. ${unmatched} group matches could not be matched to API (check team names in diagnose).`,
  });
}
