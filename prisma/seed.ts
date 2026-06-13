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

  const isE2E = process.env.E2E_TEST === "true";

  // 1. Wipe leftover simulation results.
  const { count: simCleared } = await db.simResult.deleteMany({});
  if (simCleared > 0) console.log(`✓ Cleared ${simCleared} simulation result(s)`);

  // 2. Reset ALL match scores — any scores not written by the sync job are stale
  //    (old sim runs wrote directly to Match before the SimResult migration).
  //    The sync job restores genuine results within one cycle after deploy.
  //    E2E skipped: it relies on seeded future kickoffs, not real API data.
  if (!isE2E) {
    const { count: matchReset } = await db.match.updateMany({
      where: {
        OR: [{ homeScore: { not: null } }, { awayScore: { not: null } }, { status: { not: "scheduled" } }],
      },
      data: { homeScore: null, awayScore: null, status: "scheduled" },
    });
    if (matchReset > 0) console.log(`✓ Reset ${matchReset} match(es) — sync will restore real API results`);
  }

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
        type ApiM = { id: number; stage: string; utcDate: string; homeTeam: ApiTeam; awayTeam: ApiTeam };

        const allApiMatches: ApiM[] = (data.matches ?? []) as ApiM[];
        const apiGroup = allApiMatches.filter((m) => m.stage === "GROUP_STAGE");

        const dbGroup = await db.match.findMany({
          where: { round: "Group" },
          include: { homeTeam: true, awayTeam: true },
        });

        // Normalize compound team names: " and " and "-" are equivalent separators
        // so "Bosnia and Herzegovina" matches "Bosnia-Herzegovina", etc.
        function normName(s: string): string {
          return s.toLowerCase().replace(/\s+and\s+/g, " ").replace(/-/g, " ").replace(/\s+/g, " ").trim();
        }

        // Use every name field the API provides so localisation variants work
        // (e.g. "South Korea" ↔ shortName "South Korea", name "Korea Republic")
        function apiTeamMatches(dbName: string, api: ApiTeam): boolean {
          const db = dbName.toLowerCase();
          const dbNorm = normName(dbName);
          return (
            db === api.name.toLowerCase() ||
            db === api.shortName.toLowerCase() ||
            db === api.tla.toLowerCase() ||
            db.includes(api.shortName.toLowerCase()) ||
            api.name.toLowerCase().includes(db) ||
            api.shortName.toLowerCase().includes(db) ||
            dbNorm === normName(api.name) ||
            dbNorm === normName(api.shortName)
          );
        }

        let kickoffsFixed = 0, teamsTagged = 0, matchIdsStored = 0;
        for (const dbm of dbGroup) {
          if (!dbm.homeTeam || !dbm.awayTeam) continue;
          const apiM = apiGroup.find((a) =>
            apiTeamMatches(dbm.homeTeam!.name, a.homeTeam) &&
            apiTeamMatches(dbm.awayTeam!.name, a.awayTeam)
          );
          if (!apiM) continue;

          // Store football-data.org match ID — primary key for all future syncs
          const updates: Record<string, unknown> = {};
          if (!dbm.fdMatchId) { updates.fdMatchId = apiM.id; matchIdsStored++; }

          // Fix kickoff time
          const real = new Date(apiM.utcDate);
          if (dbm.kickoff.getTime() !== real.getTime()) { updates.kickoff = real; kickoffsFixed++; }

          if (Object.keys(updates).length > 0) {
            await db.match.update({ where: { id: dbm.id }, data: updates });
          }

          // Store football-data.org numeric team IDs for fallback matching
          if (!dbm.homeTeam.fdId) {
            await db.team.update({ where: { id: dbm.homeTeam.id }, data: { fdId: apiM.homeTeam.id } });
            teamsTagged++;
          }
          if (!dbm.awayTeam.fdId) {
            await db.team.update({ where: { id: dbm.awayTeam.id }, data: { fdId: apiM.awayTeam.id } });
            teamsTagged++;
          }
        }
        console.log(`✓ API sync: ${matchIdsStored} match IDs stored, ${kickoffsFixed} kickoffs fixed, ${teamsTagged} team IDs stored`);
      } catch (e) {
        console.warn(`⚠  Kickoff correction failed (non-fatal): ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  const existingMatchCount = await db.match.count();

  // Only seed on first run
  if (existingMatchCount > 0) {
    // Ensure teams are still present (upsert is idempotent)
    for (const team of TEAMS) {
      await db.team.upsert({ where: { name: team.name }, create: team, update: team });
    }
    console.log(`✓ Matches already seeded (${existingMatchCount}), skipping match creation`);
    return;
  }

  // ── First run: build schedule from the API (non-E2E) ─────────────────────
  //
  // The API is the only authoritative source of truth for the tournament
  // schedule. We fetch it once here and store fdMatchId on every Match row and
  // fdId on every Team row from day 1 — no name matching is ever needed by sync.
  //
  // Flag emojis are the one thing the API doesn't carry, so we look them up
  // from teams-data.ts using normalised name matching (cosmetic only).
  //
  // E2E mode skips the API entirely and falls back to the hardcoded TEAMS list
  // with future kickoffs so time-based locks don't fire during the test suite.

  const STAGE_TO_ROUND: Record<string, string> = {
    GROUP_STAGE: "Group",
    LAST_32: "R32", LAST_16: "R16",
    QUARTER_FINALS: "QF", SEMI_FINALS: "SF",
    THIRD_PLACE: "3rd", FINAL: "Final",
  };

  if (!isE2E) {
    const apiKey = process.env.FOOTBALL_DATA_API_KEY;
    if (!apiKey) {
      console.warn("⚠  FOOTBALL_DATA_API_KEY not set — falling back to hardcoded seed");
    } else {
      try {
        const resp = await fetch("https://api.football-data.org/v4/competitions/WC/matches", {
          headers: { "X-Auth-Token": apiKey },
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        type ApiTeam = { id: number; name: string; shortName: string; tla: string };
        type ApiM = { id: number; utcDate: string; stage: string; group: string | null; homeTeam: ApiTeam; awayTeam: ApiTeam };
        const allApiMatches: ApiM[] = (data.matches ?? []) as ApiM[];
        console.log(`✓ Fetched ${allApiMatches.length} matches from football-data.org`);

        // --- Teams ---
        // Look up our display name + flag from teams-data (normalised name match).
        // Falls back to API name / no flag if team isn't in our list.
        const normName = (s: string) => s.toLowerCase().replace(/\s+and\s+/g, " ").replace(/-/g, " ").replace(/\s+/g, " ").trim();
        const ourTeamByNorm = new Map(TEAMS.map(t => [normName(t.name), t]));
        function resolveTeamMeta(api: ApiTeam): { name: string; flag: string } {
          return ourTeamByNorm.get(normName(api.name))
            ?? ourTeamByNorm.get(normName(api.shortName))
            ?? { name: api.name, flag: "🏳️" };
        }

        const groupApiMatches = allApiMatches.filter(m => m.stage === "GROUP_STAGE");
        const apiTeamMap = new Map<number, ApiTeam & { group: string }>();
        for (const m of groupApiMatches) {
          const grpLetter = m.group?.match(/[A-Z]$/)?.[0] ?? "?";
          if (m.homeTeam.id) apiTeamMap.set(m.homeTeam.id, { ...m.homeTeam, group: grpLetter });
          if (m.awayTeam.id) apiTeamMap.set(m.awayTeam.id, { ...m.awayTeam, group: grpLetter });
        }

        for (const [fdId, apiTeam] of apiTeamMap) {
          const { name, flag } = resolveTeamMeta(apiTeam);
          await db.team.upsert({
            where: { fdId },
            create: { fdId, name, flag, group: apiTeam.group },
            update: { flag, group: apiTeam.group }, // preserve any admin name edits
          });
        }
        console.log(`✓ ${apiTeamMap.size} teams upserted (fdId set from API)`);

        // Rebuild teamId lookup by fdId
        const fdIdToDbId = new Map(
          (await db.team.findMany({ where: { fdId: { not: null } } })).map(t => [t.fdId!, t.id])
        );

        // --- Group stage matches ---
        // Sort by kickoff so matchNumbers 1-N reflect chronological order.
        const sortedGroup = [...groupApiMatches].sort(
          (a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime()
        );
        let matchNumber = 1;
        for (const m of sortedGroup) {
          const homeTeamId = fdIdToDbId.get(m.homeTeam.id);
          const awayTeamId = fdIdToDbId.get(m.awayTeam.id);
          const grpLetter = m.group?.match(/[A-Z]$/)?.[0] ?? "?";
          await db.match.create({
            data: {
              fdMatchId: m.id,
              homeTeamId: homeTeamId ?? null,
              awayTeamId: awayTeamId ?? null,
              round: "Group",
              group: grpLetter,
              matchNumber,
              kickoff: new Date(m.utcDate),
              status: "scheduled",
            },
          });
          matchNumber++;
        }
        console.log(`✓ ${sortedGroup.length} group stage matches seeded with real kickoffs and API match IDs`);

        // --- Knockout placeholder matches ---
        // Sort each KO stage by kickoff so matchNumbers align with bracket order.
        const koRounds: { stage: string; round: string; count: number }[] = [
          { stage: "LAST_32",       round: "R32",   count: 16 },
          { stage: "LAST_16",       round: "R16",   count: 8 },
          { stage: "QUARTER_FINALS",round: "QF",    count: 4 },
          { stage: "SEMI_FINALS",   round: "SF",    count: 2 },
          { stage: "THIRD_PLACE",   round: "3rd",   count: 1 },
          { stage: "FINAL",         round: "Final", count: 1 },
        ];
        const fallbackKoBase = new Date("2026-07-01T18:00:00Z");
        let dayOffset = 0;
        for (const { stage, round, count } of koRounds) {
          const stageMatches = allApiMatches
            .filter(m => m.stage === stage)
            .sort((a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime());
          for (let i = 0; i < count; i++) {
            const apiM = stageMatches[i];
            const kickoff = apiM
              ? new Date(apiM.utcDate)
              : new Date(fallbackKoBase.getTime() + (dayOffset + i) * 24 * 60 * 60 * 1000);
            await db.match.create({
              data: {
                round,
                matchNumber,
                kickoff,
                status: "scheduled",
                ...(apiM && { fdMatchId: apiM.id }),
              },
            });
            matchNumber++;
          }
          dayOffset += count + 1;
        }
        console.log("✓ Knockout placeholder matches seeded with API match IDs");

        // Default room
        await db.room.upsert({
          where: { inviteCode: "wkbet2026" },
          create: { name: "WK 2026", inviteCode: "wkbet2026" },
          update: {},
        });
        console.log("✓ Default room created (code: wkbet2026)");
        console.log("\nSeeding complete!");
        return; // ← exit after successful API-first seed
      } catch (e) {
        console.warn(`⚠  API-first seed failed (${e instanceof Error ? e.message : e}) — falling back to hardcoded seed`);
      }
    }
  }

  // ── Fallback / E2E: hardcoded schedule from teams-data.ts ────────────────
  // Used when: E2E_TEST=true, or FOOTBALL_DATA_API_KEY is missing, or API call fails.
  // No fdMatchId / fdId stored here; the per-deploy backfill section handles those
  // for real deployments the next time the server restarts with the API key set.

  // Remove stale teams (only safe when no matches exist)
  const teamNames = TEAMS.map((t) => t.name);
  const deleted = await db.team.deleteMany({ where: { name: { notIn: teamNames } } });
  if (deleted.count > 0) console.log(`✓ Removed ${deleted.count} stale teams`);

  for (const team of TEAMS) {
    await db.team.upsert({ where: { name: team.name }, create: team, update: team });
  }
  console.log(`✓ ${TEAMS.length} teams seeded (hardcoded fallback)`);

  const teamMap = new Map((await db.team.findMany()).map((t) => [t.name, t.id]));
  const { matches, nextMatchNumber } = generateGroupMatches();
  let matchNumber = nextMatchNumber;

  const e2eGroupBase = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const fallbackGroupBase = new Date("2026-06-11T18:00:00Z");
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const kickoff = isE2E
      ? new Date(e2eGroupBase.getTime() + i * 3 * 60 * 60 * 1000)
      : new Date(fallbackGroupBase.getTime() + i * 3 * 60 * 60 * 1000);
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
  if (isE2E) console.log(`✓ ${matches.length} group stage matches seeded (E2E future kickoffs)`);
  else console.log(`✓ ${matches.length} group stage matches seeded (approximate kickoffs — deploy with API key for real times)`);

  const knockoutRounds: { round: string; count: number }[] = [
    { round: "R32", count: 16 }, { round: "R16", count: 8 },
    { round: "QF",  count: 4  }, { round: "SF",  count: 2 },
    { round: "3rd", count: 1  }, { round: "Final", count: 1 },
  ];
  const e2eKoBase = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const fallbackKoBase2 = new Date("2026-07-01T18:00:00Z");
  let dayOffset = 0;
  for (const { round, count } of knockoutRounds) {
    for (let i = 0; i < count; i++) {
      const kickoff = isE2E
        ? new Date(e2eKoBase.getTime() + (dayOffset + i) * 24 * 60 * 60 * 1000)
        : new Date(fallbackKoBase2.getTime() + (dayOffset + i) * 24 * 60 * 60 * 1000);
      await db.match.create({ data: { round, matchNumber, kickoff, status: "scheduled" } });
      matchNumber++;
    }
    dayOffset += count + 1;
  }
  console.log("✓ Knockout placeholder matches seeded");

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
