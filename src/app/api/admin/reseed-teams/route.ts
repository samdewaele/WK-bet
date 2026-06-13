import { NextResponse } from "next/server";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { TEAMS } from "@/lib/teams-data";

/**
 * POST /api/admin/reseed-teams
 *
 * Repairs the teams + group-stage matches in an existing database:
 *   1. Nullify homeTeamId/awayTeamId on group-stage matches for stale teams
 *   2. Delete stale teams (not in current TEAMS list)
 *   3. Upsert all current teams with correct names, flags, groups
 *   4. Delete and recreate all group-stage matches with correct pairings
 *   5. Backfill fdMatchId + fdId from football-data.org API (sets real kickoffs)
 *   6. Leave KO placeholder matches and all user data untouched
 *
 * Platform admin only.
 */

type ApiTeam = { id: number; name: string; shortName: string; tla: string };
type ApiMatch = { id: number; utcDate: string; stage: string; homeTeam: ApiTeam; awayTeam: ApiTeam };

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

  const currentNames = new Set<string>(TEAMS.map((t) => t.name));

  // 1. Find stale team IDs (in DB but not in current TEAMS)
  const allDbTeams = await db.team.findMany({ select: { id: true, name: true } });
  const staleIds = allDbTeams.filter((t) => !currentNames.has(t.name)).map((t) => t.id);

  // 2. Nullify group-stage match references to stale teams
  if (staleIds.length > 0) {
    await db.match.updateMany({
      where: { round: "Group", homeTeamId: { in: staleIds } },
      data: { homeTeamId: null },
    });
    await db.match.updateMany({
      where: { round: "Group", awayTeamId: { in: staleIds } },
      data: { awayTeamId: null },
    });
    await db.team.deleteMany({ where: { id: { in: staleIds } } });
  }

  // 3. Upsert current teams (fixes group assignments + renames)
  for (const team of TEAMS) {
    await db.team.upsert({
      where: { name: team.name },
      create: team,
      update: team,
    });
  }

  // 4. Rebuild group-stage matches
  await db.match.deleteMany({ where: { round: "Group" } });

  const teamMap = new Map((await db.team.findMany()).map((t) => [t.name, t.id]));
  const groups = [...new Set(TEAMS.map((t) => t.group))].sort();
  const baseDate = new Date("2026-06-11T18:00:00Z");
  let matchNumber = 1;
  let i = 0;

  for (const group of groups) {
    const groupTeams = TEAMS.filter((t) => t.group === group);
    for (let a = 0; a < groupTeams.length; a++) {
      for (let b = a + 1; b < groupTeams.length; b++) {
        await db.match.create({
          data: {
            homeTeamId: teamMap.get(groupTeams[a].name)!,
            awayTeamId: teamMap.get(groupTeams[b].name)!,
            round: "Group",
            group,
            matchNumber,
            kickoff: new Date(baseDate.getTime() + i * 3 * 60 * 60 * 1000),
            status: "scheduled",
          },
        });
        matchNumber++;
        i++;
      }
    }
  }

  // 5. Backfill fdMatchId, fdId, and real kickoffs from football-data.org API
  let fdMatchIdsSet = 0;
  let fdTeamIdsSet = 0;
  let apiError: string | null = null;
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;

  if (apiKey) {
    try {
      const resp = await fetch("https://api.football-data.org/v4/competitions/WC/matches", {
        headers: { "X-Auth-Token": apiKey },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const apiGroup = ((data.matches ?? []) as ApiMatch[]).filter((m) => m.stage === "GROUP_STAGE");

      const dbGroup = await db.match.findMany({
        where: { round: "Group" },
        include: { homeTeam: true, awayTeam: true },
      });

      for (const dbm of dbGroup) {
        if (!dbm.homeTeam || !dbm.awayTeam || dbm.fdMatchId) continue;
        const apiM = apiGroup.find(
          (a) => apiTeamMatches(dbm.homeTeam!.name, a.homeTeam) && apiTeamMatches(dbm.awayTeam!.name, a.awayTeam)
        );
        if (!apiM) continue;

        await db.match.update({
          where: { id: dbm.id },
          data: { fdMatchId: apiM.id, kickoff: new Date(apiM.utcDate) },
        });
        fdMatchIdsSet++;

        if (!dbm.homeTeam.fdId) {
          await db.team.update({ where: { id: dbm.homeTeam.id }, data: { fdId: apiM.homeTeam.id } });
          fdTeamIdsSet++;
        }
        if (!dbm.awayTeam.fdId) {
          await db.team.update({ where: { id: dbm.awayTeam.id }, data: { fdId: apiM.awayTeam.id } });
          fdTeamIdsSet++;
        }
      }
    } catch (e) {
      apiError = e instanceof Error ? e.message : String(e);
    }
  } else {
    apiError = "FOOTBALL_DATA_API_KEY not set — skipping API backfill";
  }

  return NextResponse.json({
    ok: true,
    staleTeamsRemoved: staleIds.length,
    teamsUpserted: TEAMS.length,
    groupMatchesRebuilt: i,
    apiBackfill: { fdMatchIdsSet, fdTeamIdsSet, error: apiError },
  });
}
