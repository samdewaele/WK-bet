import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import path from "path";

const url = process.env.DATABASE_URL ?? "file:./dev.db";
const filePath = url.replace(/^file:/, "");
const dbPath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
const adapter = new PrismaBetterSqlite3({ url: dbPath });
const db = new PrismaClient({ adapter } as any);

const TEAMS = [
  // Group A
  { name: "USA",          flag: "🇺🇸", group: "A" },
  { name: "Panama",       flag: "🇵🇦", group: "A" },
  { name: "Honduras",     flag: "🇭🇳", group: "A" },
  { name: "Morocco",      flag: "🇲🇦", group: "A" },
  // Group B
  { name: "Argentina",    flag: "🇦🇷", group: "B" },
  { name: "Chile",        flag: "🇨🇱", group: "B" },
  { name: "Peru",         flag: "🇵🇪", group: "B" },
  { name: "Australia",    flag: "🇦🇺", group: "B" },
  // Group C
  { name: "Mexico",       flag: "🇲🇽", group: "C" },
  { name: "Ecuador",      flag: "🇪🇨", group: "C" },
  { name: "Venezuela",    flag: "🇻🇪", group: "C" },
  { name: "New Zealand",  flag: "🇳🇿", group: "C" },
  // Group D
  { name: "France",       flag: "🇫🇷", group: "D" },
  { name: "Belgium",      flag: "🇧🇪", group: "D" },
  { name: "Paraguay",     flag: "🇵🇾", group: "D" },
  { name: "Saudi Arabia", flag: "🇸🇦", group: "D" },
  // Group E
  { name: "Germany",      flag: "🇩🇪", group: "E" },
  { name: "Portugal",     flag: "🇵🇹", group: "E" },
  { name: "Mexico B",     flag: "🇲🇽", group: "E" }, // placeholder
  { name: "Cameroon",     flag: "🇨🇲", group: "E" },
  // Group F
  { name: "Spain",        flag: "🇪🇸", group: "F" },
  { name: "Croatia",      flag: "🇭🇷", group: "F" },
  { name: "Bolivia",      flag: "🇧🇴", group: "F" },
  { name: "Japan",        flag: "🇯🇵", group: "F" },
  // Group G
  { name: "Brazil",       flag: "🇧🇷", group: "G" },
  { name: "Colombia",     flag: "🇨🇴", group: "G" },
  { name: "Costa Rica",   flag: "🇨🇷", group: "G" },
  { name: "Nigeria",      flag: "🇳🇬", group: "G" },
  // Group H
  { name: "England",      flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", group: "H" },
  { name: "Netherlands",  flag: "🇳🇱", group: "H" },
  { name: "Senegal",      flag: "🇸🇳", group: "H" },
  { name: "Iran",         flag: "🇮🇷", group: "H" },
  // Group I
  { name: "Italy",        flag: "🇮🇹", group: "I" },
  { name: "Switzerland",  flag: "🇨🇭", group: "I" },
  { name: "Canada",       flag: "🇨🇦", group: "I" },
  { name: "Uruguay",      flag: "🇺🇾", group: "I" },
  // Group J
  { name: "Denmark",      flag: "🇩🇰", group: "J" },
  { name: "Serbia",       flag: "🇷🇸", group: "J" },
  { name: "Tunisia",      flag: "🇹🇳", group: "J" },
  { name: "Cuba",         flag: "🇨🇺", group: "J" },
  // Group K
  { name: "South Korea",  flag: "🇰🇷", group: "K" },
  { name: "Ghana",        flag: "🇬🇭", group: "K" },
  { name: "South Africa", flag: "🇿🇦", group: "K" },
  { name: "Indonesia",    flag: "🇮🇩", group: "K" },
  // Group L
  { name: "Turkey",       flag: "🇹🇷", group: "L" },
  { name: "Czech Republic", flag: "🇨🇿", group: "L" },
  { name: "Qatar",        flag: "🇶🇦", group: "L" },
  { name: "Jamaica",      flag: "🇯🇲", group: "L" },
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
  const existingMatchCount = await db.match.count();
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
