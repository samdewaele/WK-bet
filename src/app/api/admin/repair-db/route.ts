import { NextResponse } from "next/server";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { fetchWCMatches, teamNameMatches } from "@/lib/football-data";

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

export async function POST() {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let allApiMatches;
  try {
    allApiMatches = await fetchWCMatches();
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
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

    // Try to find the API counterpart — check both orientations because the
    // DB seed may have assigned home/away in the opposite order from the API.
    const apiMNormal = apiGroup.find(
      (a) => teamNameMatches(dbm.homeTeam!.name, a.homeTeam) && teamNameMatches(dbm.awayTeam!.name, a.awayTeam)
    );
    const apiMReversed = !apiMNormal
      ? apiGroup.find(
          (a) => teamNameMatches(dbm.homeTeam!.name, a.awayTeam) && teamNameMatches(dbm.awayTeam!.name, a.homeTeam)
        )
      : undefined;
    const apiM = apiMNormal ?? apiMReversed;

    if (!apiM) {
      unmatched++;
      continue;
    }

    const updates: Record<string, unknown> = {};
    if (!dbm.fdMatchId) { updates.fdMatchId = apiM.id; matchIdsSet++; }
    const realKickoff = new Date(apiM.utcDate);
    if (dbm.kickoff.getTime() !== realKickoff.getTime()) { updates.kickoff = realKickoff; kickoffsFixed++; }

    // If found via reversed orientation, swap homeTeamId ↔ awayTeamId so the
    // DB matches the API's slot assignment and future score syncs are correct.
    if (apiMReversed) {
      updates.homeTeamId = dbm.awayTeam.id;
      updates.awayTeamId = dbm.homeTeam.id;
    }

    if (Object.keys(updates).length > 0) {
      await db.match.update({ where: { id: dbm.id }, data: updates });
    }

    // Set team fdIds based on which slot each team ends up in after any swap.
    const finalHomeTeam = apiMReversed ? dbm.awayTeam : dbm.homeTeam;
    const finalAwayTeam = apiMReversed ? dbm.homeTeam : dbm.awayTeam;
    if (!finalHomeTeam.fdId) {
      await db.team.update({ where: { id: finalHomeTeam.id }, data: { fdId: apiM.homeTeam.id } });
      teamIdsSet++;
    }
    if (!finalAwayTeam.fdId) {
      await db.team.update({ where: { id: finalAwayTeam.id }, data: { fdId: apiM.awayTeam.id } });
      teamIdsSet++;
    }
  }

  return NextResponse.json({
    ok: true,
    matchIdsSet,
    kickoffsFixed,
    teamIdsSet,
    unmatched,
    message: `Set ${matchIdsSet} match IDs, fixed ${kickoffsFixed} kickoffs, set ${teamIdsSet} team IDs. ${unmatched} group matches could not be matched to API (check team names in diagnose). Home/away was corrected where DB order differed from API.`,
  });
}
