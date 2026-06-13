import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import path from "path";
import { TEAMS } from "../src/lib/teams-data";

export { TEAMS };

const url = process.env.DATABASE_URL ?? "file:./dev.db";
const filePath = url.replace(/^file:/, "");
const dbPath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
const adapter = new PrismaBetterSqlite3({ url: dbPath });
const db = new PrismaClient({ adapter } as any);

// Generate group stage matches: each group has 6 matches (C(4,2))
function generateGroupMatches() {
  const matches: {
    homeTeamName: string;
    awayTeamName: string;
    round: string;
    group: string;
    matchNumber: number;
  }[] = [];

  const groups = [...new Set(TEAMS.map((t) => t.group))].sort();
  let matchNumber = 1;

  for (const group of groups) {
    const groupTeams = TEAMS.filter((t) => t.group === group);
    // All pairs within the group
    for (let i = 0; i < groupTeams.length; i++) {
      for (let j = i + 1; j < groupTeams.length; j++) {
        matches.push({
          homeTeamName: groupTeams[i].name,
          awayTeamName: groupTeams[j].name,
          round: "Group",
          group,
          matchNumber,
        });
        matchNumber++;
      }
    }
  }
  return { matches, nextMatchNumber: matchNumber };
}

async function main() {
  console.log("Seeding database...");

  // ── Per-deploy cleanup (runs every time) ─────────────────────────────────────

  // 1. Wipe leftover simulation results.
  const { count: simCleared } = await db.simResult.deleteMany({});
  if (simCleared > 0) console.log(`✓ Cleared ${simCleared} simulation result(s)`);

  // 2. Reset KO match scores — simulation runs write fake scores to KO slots;
  //    the sync job restores any genuine results within one cycle after deploy.
  const { count: koReset } = await db.match.updateMany({
    where: {
      round: { in: ["R32", "R16", "QF", "SF", "3rd", "Final"] },
      OR: [{ homeScore: { not: null } }, { awayScore: { not: null } }, { status: { not: "scheduled" } }],
    },
    data: { homeScore: null, awayScore: null, status: "scheduled" },
  });
  if (koReset > 0) console.log(`✓ Reset ${koReset} KO match(es) with stale simulation scores`);

  const isE2E = process.env.E2E_TEST === "true";

  // 3. Fix group stage kickoff times from the real API.
  //    seed.ts initially creates matches with approximate 3h-apart kickoffs.
  //    This corrects them so per-group prediction locks fire at the right time.
  //    Scores are NOT touched here — the sync job owns match scores entirely.
  if (!isE2E) {
    const apiKey = process.env.FOOTBALL_DATA_API_KEY;
    if (!apiKey) {
      console.warn("⚠  FOOTBALL_DATA_API_KEY not set — skipping kickoff correction");
    } else {
      try {
        const resp = await fetch("https://api.football-data.org/v4/competitions/WC/matches", {
          headers: { "X-Auth-Token": apiKey },
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        type ApiTeam = { id: number; name: string; shortName: string; tla: string };
        type ApiM = { stage: string; utcDate: string; homeTeam: ApiTeam; awayTeam: ApiTeam };

        const allApiMatches: ApiM[] = (data.matches ?? []) as ApiM[];
        const apiGroup = allApiMatches.filter((m) => m.stage === "GROUP_STAGE");

        const dbGroup = await db.match.findMany({
          where: { round: "Group" },
          include: { homeTeam: true, awayTeam: true },
        });

        // Use every name field the API provides so localisation variants work
        // (e.g. "South Korea" ↔ shortName "South Korea", name "Korea Republic")
        function apiTeamMatches(dbName: string, api: ApiTeam): boolean {
          const db = dbName.toLowerCase();
          return (
            db === api.name.toLowerCase() ||
            db === api.shortName.toLowerCase() ||
            db === api.tla.toLowerCase() ||
            db.includes(api.shortName.toLowerCase()) ||
            api.name.toLowerCase().includes(db) ||
            api.shortName.toLowerCase().includes(db)
          );
        }

        let kickoffsFixed = 0, teamsTagged = 0;
        for (const dbm of dbGroup) {
          if (!dbm.homeTeam || !dbm.awayTeam) continue;
          const apiM = apiGroup.find((a) =>
            apiTeamMatches(dbm.homeTeam!.name, a.homeTeam) &&
            apiTeamMatches(dbm.awayTeam!.name, a.awayTeam)
          );
          if (!apiM) continue;

          // Fix kickoff time
          const real = new Date(apiM.utcDate);
          if (dbm.kickoff.getTime() !== real.getTime()) {
            await db.match.update({ where: { id: dbm.id }, data: { kickoff: real } });
            kickoffsFixed++;
          }

          // Store football-data.org numeric team IDs for reliable future matching
          if (!dbm.homeTeam.fdId) {
            await db.team.update({ where: { id: dbm.homeTeam.id }, data: { fdId: apiM.homeTeam.id } });
            teamsTagged++;
          }
          if (!dbm.awayTeam.fdId) {
            await db.team.update({ where: { id: dbm.awayTeam.id }, data: { fdId: apiM.awayTeam.id } });
            teamsTagged++;
          }
        }
        console.log(`✓ API sync: ${kickoffsFixed} kickoffs fixed, ${teamsTagged} team IDs stored`);
      } catch (e) {
        console.warn(`⚠  Kickoff correction failed (non-fatal): ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  const existingMatchCount = await db.match.count();

  // Remove stale teams (only safe when no matches reference them yet)
  if (existingMatchCount === 0) {
    const teamNames = TEAMS.map((t) => t.name);
    const deleted = await db.team.deleteMany({ where: { name: { notIn: teamNames } } });
    if (deleted.count > 0) console.log(`✓ Removed ${deleted.count} stale teams`);
  }

  // Upsert teams
  for (const team of TEAMS) {
    await db.team.upsert({
      where: { name: team.name },
      create: team,
      update: team,
    });
  }
  console.log(`✓ ${TEAMS.length} teams seeded`);

  // Only seed matches on first run — don't overwrite admin-entered scores
  if (existingMatchCount > 0) {
    console.log(`✓ Matches already seeded (${existingMatchCount}), skipping`);
    return;
  }

  const teamMap = new Map(
    (await db.team.findMany()).map((t) => [t.name, t.id])
  );

  const { matches, nextMatchNumber } = generateGroupMatches();
  let matchNumber = nextMatchNumber;

  // Fetch real fixture times from football-data.org (skipped for E2E and when no key)
  type ApiMatch = {
    utcDate: string;
    stage: string;
    homeTeam: { name: string; shortName: string };
    awayTeam: { name: string; shortName: string };
  };
  let apiMatches: ApiMatch[] = [];
  if (!isE2E) {
    const apiKey = process.env.FOOTBALL_DATA_API_KEY;
    if (!apiKey) {
      console.warn("⚠  FOOTBALL_DATA_API_KEY not set — using approximate kickoff times");
    } else {
      try {
        const resp = await fetch("https://api.football-data.org/v4/competitions/WC/matches", {
          headers: { "X-Auth-Token": apiKey },
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        apiMatches = (data.matches ?? []) as ApiMatch[];
        console.log(`✓ Fetched ${apiMatches.length} match schedules from football-data.org`);
      } catch (e) {
        console.warn(`⚠  Could not fetch real fixture times (using approximate): ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  /** Find the real kickoff for a (home, away) team name pair using the same fuzzy
   *  name matching that sync-matches.ts uses, so seed and sync stay consistent. */
  function findApiKickoff(homeName: string, awayName: string, stage: string): Date | null {
    const m = apiMatches.find((a) => {
      if (a.stage !== stage) return false;
      const homeMatch =
        homeName.toLowerCase() === a.homeTeam.name.toLowerCase() ||
        homeName.toLowerCase().includes(a.homeTeam.shortName.toLowerCase()) ||
        a.homeTeam.name.toLowerCase().includes(homeName.toLowerCase());
      const awayMatch =
        awayName.toLowerCase() === a.awayTeam.name.toLowerCase() ||
        awayName.toLowerCase().includes(a.awayTeam.shortName.toLowerCase()) ||
        a.awayTeam.name.toLowerCase().includes(awayName.toLowerCase());
      return homeMatch && awayMatch;
    });
    return m ? new Date(m.utcDate) : null;
  }

  // Create group stage matches.
  // E2E seeds a fresh DB on every run — kickoffs must stay in the future or
  // every time-based lock (tournament started, per-group locks, KO prediction
  // window) trips and the suite 403s everywhere.
  const e2eGroupBase = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const fallbackGroupBase = new Date("2026-06-11T18:00:00Z");
  let realKickoffCount = 0;
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    let kickoff: Date;
    if (isE2E) {
      kickoff = new Date(e2eGroupBase.getTime() + i * 3 * 60 * 60 * 1000);
    } else {
      const real = findApiKickoff(m.homeTeamName, m.awayTeamName, "GROUP_STAGE");
      if (real) { kickoff = real; realKickoffCount++; }
      else kickoff = new Date(fallbackGroupBase.getTime() + i * 3 * 60 * 60 * 1000);
    }
    await db.match.create({
      data: {
        homeTeamId: teamMap.get(m.homeTeamName)!,
        awayTeamId: teamMap.get(m.awayTeamName)!,
        round: m.round,
        group: m.group,
        matchNumber: m.matchNumber,
        kickoff,
        status: "scheduled",
      },
    });
  }
  if (!isE2E) console.log(`✓ ${matches.length} group stage matches seeded (${realKickoffCount} with real kickoff times)`);
  else console.log(`✓ ${matches.length} group stage matches seeded (E2E future kickoffs)`);

  // Placeholder knockout matches (TBD teams)
  // Bucket API matches by stage for real kickoff times where available
  const STAGE_TO_ROUND: Record<string, string> = {
    LAST_32: "R32", LAST_16: "R16",
    QUARTER_FINALS: "QF", SEMI_FINALS: "SF",
    THIRD_PLACE: "3rd", FINAL: "Final",
  };
  const koApiByRound = new Map<string, Date[]>();
  for (const [stage, round] of Object.entries(STAGE_TO_ROUND)) {
    const times = apiMatches
      .filter((a) => a.stage === stage)
      .map((a) => new Date(a.utcDate))
      .sort((a, b) => a.getTime() - b.getTime());
    if (times.length) koApiByRound.set(round, times);
  }

  const knockoutRounds: { round: string; count: number }[] = [
    { round: "R32", count: 16 },
    { round: "R16", count: 8 },
    { round: "QF", count: 4 },
    { round: "SF", count: 2 },
    { round: "3rd", count: 1 },
    { round: "Final", count: 1 },
  ];

  const e2eKoBase = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const fallbackKoBase = new Date("2026-07-01T18:00:00Z");
  let dayOffset = 0;
  const koCounters = new Map<string, number>();

  for (const { round, count } of knockoutRounds) {
    const realTimes = koApiByRound.get(round);
    for (let i = 0; i < count; i++) {
      let kickoff: Date;
      if (isE2E) {
        kickoff = new Date(e2eKoBase.getTime() + (dayOffset + i) * 24 * 60 * 60 * 1000);
      } else if (realTimes && i < realTimes.length) {
        kickoff = realTimes[i];
      } else {
        kickoff = new Date(fallbackKoBase.getTime() + (dayOffset + i) * 24 * 60 * 60 * 1000);
      }
      await db.match.create({
        data: { round, matchNumber, kickoff, status: "scheduled" },
      });
      matchNumber++;
    }
    koCounters.set(round, realTimes?.length ?? 0);
    dayOffset += count + 1;
  }
  console.log(`✓ Knockout placeholder matches seeded`);

  // Create default room
  await db.room.upsert({
    where: { inviteCode: "wkbet2026" },
    create: { name: "WK 2026", inviteCode: "wkbet2026" },
    update: {},
  });
  console.log("✓ Default room created (code: wkbet2026)");

  console.log("\nSeeding complete!");
}

main()
  .catch(console.error)
  .finally(() => process.exit(0));
