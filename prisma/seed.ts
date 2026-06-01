import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import path from "path";

const url = process.env.DATABASE_URL ?? "file:./dev.db";
const filePath = url.replace(/^file:/, "");
const dbPath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
const adapter = new PrismaBetterSqlite3({ url: dbPath });
const db = new PrismaClient({ adapter } as any);

export const TEAMS = [
  // Group A — hosts: Mexico
  { name: "Mexico",                 flag: "🇲🇽", group: "A" },
  { name: "South Africa",           flag: "🇿🇦", group: "A" },
  { name: "South Korea",            flag: "🇰🇷", group: "A" },
  { name: "Czechia",                flag: "🇨🇿", group: "A" },
  // Group B — hosts: Canada
  { name: "Canada",                 flag: "🇨🇦", group: "B" },
  { name: "Switzerland",            flag: "🇨🇭", group: "B" },
  { name: "Qatar",                  flag: "🇶🇦", group: "B" },
  { name: "Bosnia and Herzegovina", flag: "🇧🇦", group: "B" },
  // Group C
  { name: "Brazil",                 flag: "🇧🇷", group: "C" },
  { name: "Morocco",                flag: "🇲🇦", group: "C" },
  { name: "Haiti",                  flag: "🇭🇹", group: "C" },
  { name: "Scotland",               flag: "🏴󠁧󠁢󠁳󠁣󠁴󠁿", group: "C" },
  // Group D — hosts: United States
  { name: "United States",          flag: "🇺🇸", group: "D" },
  { name: "Paraguay",               flag: "🇵🇾", group: "D" },
  { name: "Australia",              flag: "🇦🇺", group: "D" },
  { name: "Türkiye",                flag: "🇹🇷", group: "D" },
  // Group E
  { name: "Germany",                flag: "🇩🇪", group: "E" },
  { name: "Curaçao",                flag: "🇨🇼", group: "E" },
  { name: "Côte d'Ivoire",          flag: "🇨🇮", group: "E" },
  { name: "Ecuador",                flag: "🇪🇨", group: "E" },
  // Group F
  { name: "Netherlands",            flag: "🇳🇱", group: "F" },
  { name: "Japan",                  flag: "🇯🇵", group: "F" },
  { name: "Tunisia",                flag: "🇹🇳", group: "F" },
  { name: "Sweden",                 flag: "🇸🇪", group: "F" },
  // Group G
  { name: "Belgium",                flag: "🇧🇪", group: "G" },
  { name: "Egypt",                  flag: "🇪🇬", group: "G" },
  { name: "Iran",                   flag: "🇮🇷", group: "G" },
  { name: "New Zealand",            flag: "🇳🇿", group: "G" },
  // Group H
  { name: "Spain",                  flag: "🇪🇸", group: "H" },
  { name: "Cabo Verde",             flag: "🇨🇻", group: "H" },
  { name: "Saudi Arabia",           flag: "🇸🇦", group: "H" },
  { name: "Uruguay",                flag: "🇺🇾", group: "H" },
  // Group I
  { name: "France",                 flag: "🇫🇷", group: "I" },
  { name: "Senegal",                flag: "🇸🇳", group: "I" },
  { name: "Iraq",                   flag: "🇮🇶", group: "I" },
  { name: "Norway",                 flag: "🇳🇴", group: "I" },
  // Group J
  { name: "Argentina",              flag: "🇦🇷", group: "J" },
  { name: "Algeria",                flag: "🇩🇿", group: "J" },
  { name: "Austria",                flag: "🇦🇹", group: "J" },
  { name: "Jordan",                 flag: "🇯🇴", group: "J" },
  // Group K
  { name: "Portugal",               flag: "🇵🇹", group: "K" },
  { name: "Uzbekistan",             flag: "🇺🇿", group: "K" },
  { name: "Colombia",               flag: "🇨🇴", group: "K" },
  { name: "Congo DR",               flag: "🇨🇩", group: "K" },
  // Group L
  { name: "England",                flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", group: "L" },
  { name: "Croatia",                flag: "🇭🇷", group: "L" },
  { name: "Ghana",                  flag: "🇬🇭", group: "L" },
  { name: "Panama",                 flag: "🇵🇦", group: "L" },
];

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
  const baseDate = new Date("2026-06-11T18:00:00Z");

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

  // Create group stage matches
  const baseDate = new Date("2026-06-11T18:00:00Z");
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

  const knockoutBase = new Date("2026-07-01T18:00:00Z");
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
