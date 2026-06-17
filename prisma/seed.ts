import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import path from "path";
import { TEAMS } from "../src/lib/teams-data";
import { fetchWCMatches, teamNameMatches } from "../src/lib/football-data";
import type { FDTeam } from "../src/lib/football-data";

export { TEAMS };

const url = process.env.DATABASE_URL ?? "file:./dev.db";
const filePath = url.replace(/^file:/, "");
const dbPath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
const adapter = new PrismaBetterSqlite3({ url: dbPath });
const db = new PrismaClient({ adapter } as any);

const isE2E = process.env.E2E_TEST === "true";

// Resolve display name + flag from local TEAMS list (API doesn't carry flag emojis).
function resolveLocalTeam(apiTeam: FDTeam): { name: string; flag: string } {
  const local = TEAMS.find((t) => teamNameMatches(t.name, apiTeam));
  return local ? { name: local.name, flag: local.flag } : { name: apiTeam.name, flag: "🏳️" };
}

// E2E only: generate group matches from TEAMS array (no API call needed in tests).
function generateGroupMatches() {
  const matches: { homeTeamName: string; awayTeamName: string; round: string; group: string; matchNumber: number }[] = [];
  const groups = [...new Set(TEAMS.map((t) => t.group))].sort();
  let matchNumber = 1;
  for (const group of groups) {
    const groupTeams = TEAMS.filter((t) => t.group === group);
    for (let i = 0; i < groupTeams.length; i++) {
      for (let j = i + 1; j < groupTeams.length; j++) {
        matches.push({ homeTeamName: groupTeams[i].name, awayTeamName: groupTeams[j].name, round: "Group", group, matchNumber });
        matchNumber++;
      }
    }
  }
  return { matches, nextMatchNumber: matchNumber };
}

async function main() {
  console.log("Seeding database...");

  // ── Per-deploy cleanup ─────────────────────────────────────────────────────
  // Clear simulation results (test artifacts). Real match scores are NOT reset
  // here — they come from the API and must survive deploys. The stale-reset
  // pass in the sync loop already clears any sim scores for future matches.
  const { count: simCleared } = await db.simResult.deleteMany({});
  if (simCleared > 0) console.log(`✓ Cleared ${simCleared} simulation result(s)`);

  // On re-runs (matches already exist) just ensure teams are present and exit.
  if (await db.match.count() > 0) {
    for (const team of TEAMS) {
      await db.team.upsert({ where: { name: team.name }, create: team, update: team });
    }
    console.log("✓ Matches already seeded, skipping match creation");
    return;
  }

  // ── E2E: hardcoded schedule with future kickoffs ───────────────────────────
  if (isE2E) {
    for (const team of TEAMS) {
      await db.team.upsert({ where: { name: team.name }, create: team, update: team });
    }
    const teamMap = new Map((await db.team.findMany()).map((t) => [t.name, t.id]));
    const { matches, nextMatchNumber } = generateGroupMatches();
    let matchNumber = nextMatchNumber;
    const groupBase = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      await db.match.create({
        data: {
          homeTeamId: teamMap.get(m.homeTeamName)!,
          awayTeamId: teamMap.get(m.awayTeamName)!,
          round: m.round, group: m.group, matchNumber: m.matchNumber,
          kickoff: new Date(groupBase.getTime() + i * 3 * 60 * 60 * 1000),
          status: "scheduled",
        },
      });
    }
    console.log(`✓ ${TEAMS.length} teams + ${matches.length} group matches seeded (E2E)`);
    const koRoundsE2E: { round: string; count: number }[] = [
      { round: "R32", count: 16 }, { round: "R16", count: 8 }, { round: "QF", count: 4 },
      { round: "SF", count: 2 }, { round: "3rd", count: 1 }, { round: "Final", count: 1 },
    ];
    const koBase = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    let dayOffset = 0;
    for (const { round, count } of koRoundsE2E) {
      for (let i = 0; i < count; i++) {
        await db.match.create({ data: { round, matchNumber, kickoff: new Date(koBase.getTime() + (dayOffset + i) * 86400000), status: "scheduled" } });
        matchNumber++;
      }
      dayOffset += count + 1;
    }
    console.log("✓ Knockout placeholder matches seeded (E2E)");
    await db.room.upsert({ where: { inviteCode: "wkbet2026" }, create: { name: "WK 2026", inviteCode: "wkbet2026" }, update: {} });
    console.log("\nSeeding complete!");
    return;
  }

  // ── API-first seed ─────────────────────────────────────────────────────────
  // fetchWCMatches() throws if FOOTBALL_DATA_API_KEY is missing — that's intentional.
  // A production deploy without the API key should fail loudly, not silently use stale data.
  const allApiMatches = await fetchWCMatches();
  console.log(`✓ Fetched ${allApiMatches.length} matches from football-data.org`);

  // Teams: every team gets fdId from the API. Display name + flag come from TEAMS list.
  const groupApiMatches = allApiMatches.filter((m) => m.stage === "GROUP_STAGE");
  const apiTeamMap = new Map<number, FDTeam & { group: string }>();
  for (const m of groupApiMatches) {
    const grpLetter = m.group?.match(/[A-Z]$/)?.[0] ?? "?";
    if (m.homeTeam.id) apiTeamMap.set(m.homeTeam.id, { ...m.homeTeam, group: grpLetter });
    if (m.awayTeam.id) apiTeamMap.set(m.awayTeam.id, { ...m.awayTeam, group: grpLetter });
  }
  for (const [fdId, apiTeam] of apiTeamMap) {
    const { name, flag } = resolveLocalTeam(apiTeam);
    await db.team.upsert({
      where: { fdId },
      create: { fdId, name, flag, group: apiTeam.group },
      update: { flag, group: apiTeam.group },
    });
  }
  console.log(`✓ ${apiTeamMap.size} teams upserted (fdId from API)`);

  const fdIdToDbId = new Map(
    (await db.team.findMany({ where: { fdId: { not: null } } })).map((t) => [t.fdId!, t.id])
  );

  // Group stage matches: sorted chronologically, fdMatchId from API.
  const sortedGroup = [...groupApiMatches].sort((a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime());
  let matchNumber = 1;
  for (const m of sortedGroup) {
    const grpLetter = m.group?.match(/[A-Z]$/)?.[0] ?? "?";
    await db.match.create({
      data: {
        fdMatchId: m.id,
        homeTeamId: fdIdToDbId.get(m.homeTeam.id) ?? null,
        awayTeamId: fdIdToDbId.get(m.awayTeam.id) ?? null,
        round: "Group", group: grpLetter, matchNumber,
        kickoff: new Date(m.utcDate), status: "scheduled",
      },
    });
    matchNumber++;
  }
  console.log(`✓ ${sortedGroup.length} group stage matches seeded (fdMatchId from API)`);

  // Knockout placeholder matches: use API kickoffs where available.
  const koRounds: { stage: string; round: string; count: number }[] = [
    { stage: "LAST_32",        round: "R32",   count: 16 },
    { stage: "LAST_16",        round: "R16",   count: 8  },
    { stage: "QUARTER_FINALS", round: "QF",    count: 4  },
    { stage: "SEMI_FINALS",    round: "SF",    count: 2  },
    { stage: "THIRD_PLACE",    round: "3rd",   count: 1  },
    { stage: "FINAL",          round: "Final", count: 1  },
  ];
  const fallbackKoBase = new Date("2026-07-01T18:00:00Z");
  let dayOffset = 0;
  for (const { stage, round, count } of koRounds) {
    const stageMatches = allApiMatches
      .filter((m) => m.stage === stage)
      .sort((a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime());
    for (let i = 0; i < count; i++) {
      const apiM = stageMatches[i];
      await db.match.create({
        data: {
          round, matchNumber,
          kickoff: apiM ? new Date(apiM.utcDate) : new Date(fallbackKoBase.getTime() + (dayOffset + i) * 86400000),
          status: "scheduled",
          ...(apiM && { fdMatchId: apiM.id }),
        },
      });
      matchNumber++;
    }
    dayOffset += count + 1;
  }
  console.log("✓ Knockout placeholder matches seeded (fdMatchId from API)");

  await db.room.upsert({ where: { inviteCode: "wkbet2026" }, create: { name: "WK 2026", inviteCode: "wkbet2026" }, update: {} });
  console.log("✓ Default room created (code: wkbet2026)");
  console.log("\nSeeding complete!");
}

main()
  .catch(console.error)
  .finally(() => process.exit(0));
