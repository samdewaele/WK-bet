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

  // Clean any simulation data left over from previous runs — runs on every deploy.
  const { count: simCleared } = await db.simResult.deleteMany({});
  if (simCleared > 0) console.log(`✓ Cleared ${simCleared} leftover simulation result(s)`);

  // Reset KO matches that carry stale simulation scores — runs on every deploy.
  // No kickoff filter: simulations set past kickoffs on KO matches, so a
  // future-only guard lets them slip through. Wiping all KO scores is safe
  // because the sync job will restore any genuinely played KO results from the
  // API within one sync cycle after deploy.
  const { count: koReset } = await db.match.updateMany({
    where: {
      round: { in: ["R32", "R16", "QF", "SF", "3rd", "Final"] },
      OR: [
        { homeScore: { not: null } },
        { awayScore: { not: null } },
        { status: { not: "scheduled" } },
      ],
    },
    data: { homeScore: null, awayScore: null, status: "scheduled" },
  });
  if (koReset > 0) console.log(`✓ Reset ${koReset} KO match(es) with stale simulation scores`);

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

  // Create group stage matches.
  // E2E seeds a fresh DB on every run — kickoffs must stay in the future or
  // every time-based lock (tournament started, per-group locks, KO prediction
  // window) trips and the suite 403s everywhere.
  const isE2E = process.env.E2E_TEST === "true";
  const baseDate = isE2E
    ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    : new Date("2026-06-11T18:00:00Z");
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const kickoff = new Date(baseDate.getTime() + i * 3 * 60 * 60 * 1000); // 3h apart
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
  console.log(`✓ ${matches.length} group stage matches seeded`);

  // Placeholder knockout matches (TBD teams)
  const knockoutRounds: { round: string; count: number }[] = [
    { round: "R32", count: 16 },
    { round: "R16", count: 8 },
    { round: "QF", count: 4 },
    { round: "SF", count: 2 },
    { round: "3rd", count: 1 },
    { round: "Final", count: 1 },
  ];

  // Group stage spans ~9 days (72 matches × 3h); KO must start after it ends
  const knockoutBase = isE2E
    ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    : new Date("2026-07-01T18:00:00Z");
  let dayOffset = 0;

  for (const { round, count } of knockoutRounds) {
    for (let i = 0; i < count; i++) {
      const kickoff = new Date(
        knockoutBase.getTime() + (dayOffset + i) * 24 * 60 * 60 * 1000
      );
      await db.match.create({
        data: {
          round,
          matchNumber,
          kickoff,
          status: "scheduled",
        },
      });
      matchNumber++;
    }
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
