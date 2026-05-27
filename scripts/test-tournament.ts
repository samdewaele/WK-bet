/**
 * Manual test tournament script.
 *
 * Run with:
 *   DATABASE_URL=file:./dev.db npx tsx --tsconfig tsconfig.json scripts/test-tournament.ts
 *
 * What it does:
 *   1. Creates 5 test players in an isolated betting room
 *   2. Submits predictions of varying quality for 3 Group A matches
 *   3. Creates 2 admin side bets + 1 P2P bet
 *   4. Simulates match results (sets scores + status = finished)
 *   5. Scores all predictions
 *   6. Prints a full payout verification report
 *   7. Cleans up all test data
 */

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import path from "path";
import { calculatePoints, type Round } from "../src/lib/points";

// ---------------------------------------------------------------------------
// DB setup (mirrors src/lib/db.ts)
// ---------------------------------------------------------------------------
const url = process.env.DATABASE_URL ?? "file:./dev.db";
const filePath = url.replace(/^file:/, "");
const dbPath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
const adapter = new PrismaBetterSqlite3({ url: dbPath });
const db = new PrismaClient({ adapter } as any);

// ---------------------------------------------------------------------------
// Test data definitions
// ---------------------------------------------------------------------------

const TEST_PREFIX = "test-tournament-";

const TEST_USERS = [
  { name: "Alice (perfect)", email: `${TEST_PREFIX}alice@test.local` },
  { name: "Bob (right result)", email: `${TEST_PREFIX}bob@test.local` },
  { name: "Charlie (mixed)", email: `${TEST_PREFIX}charlie@test.local` },
  { name: "Diana (mostly wrong)", email: `${TEST_PREFIX}diana@test.local` },
  { name: "Eve (all wrong)", email: `${TEST_PREFIX}eve@test.local` },
];

const ENTRY_FEE = 10; // € per player

// The 3 Group A matches we'll use for the simulation.
// Actual results:  USA 2-0 Panama | USA 1-1 Honduras | Panama 0-1 Honduras
const SIM_MATCHES = [
  { homeTeam: "USA",    awayTeam: "Panama",   actualHome: 2, actualAway: 0 },
  { homeTeam: "USA",    awayTeam: "Honduras",  actualHome: 1, actualAway: 1 },
  { homeTeam: "Panama", awayTeam: "Honduras",  actualHome: 0, actualAway: 1 },
] as const;

// Predictions per player (indices align with SIM_MATCHES)
const PREDICTIONS: Record<string, Array<{ home: number; away: number }>> = {
  "Alice (perfect)":      [{ home: 2, away: 0 }, { home: 1, away: 1 }, { home: 0, away: 1 }],
  "Bob (right result)":   [{ home: 1, away: 0 }, { home: 2, away: 2 }, { home: 0, away: 2 }],
  "Charlie (mixed)":      [{ home: 2, away: 0 }, { home: 0, away: 0 }, { home: 1, away: 0 }],
  "Diana (mostly wrong)": [{ home: 0, away: 2 }, { home: 1, away: 0 }, { home: 1, away: 0 }],
  "Eve (all wrong)":      [{ home: 0, away: 1 }, { home: 0, away: 2 }, { home: 2, away: 0 }],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sep(char = "─", width = 70) {
  console.log(char.repeat(width));
}

function header(title: string) {
  sep("═");
  console.log(`  ${title}`);
  sep("═");
}

function fmt(n: number, decimals = 2) {
  return `€${n.toFixed(decimals)}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  header("TEST TOURNAMENT — WK-Bet 2026");

  // -------------------------------------------------------------------------
  // 1. Cleanup previous run
  // -------------------------------------------------------------------------
  console.log("\n[1] Cleaning up previous test data…");
  const existingUsers = await db.user.findMany({
    where: { email: { startsWith: TEST_PREFIX } },
    select: { id: true },
  });
  const existingIds = existingUsers.map((u) => u.id);

  if (existingIds.length > 0) {
    await db.prediction.deleteMany({ where: { userId: { in: existingIds } } });
    await db.sideBetEntry.deleteMany({ where: { userId: { in: existingIds } } });
    await db.p2PSideBet.deleteMany({ where: { proposerId: { in: existingIds } } });
    await db.roomMember.deleteMany({ where: { userId: { in: existingIds } } });
  }
  // Remove any leftover test room
  await db.room.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
  // Remove test users
  if (existingIds.length > 0) {
    await db.user.deleteMany({ where: { id: { in: existingIds } } });
  }
  console.log("  ✓ Clean slate");

  // -------------------------------------------------------------------------
  // 2. Create test users
  // -------------------------------------------------------------------------
  console.log("\n[2] Creating test users…");
  const users = await Promise.all(
    TEST_USERS.map((u) =>
      db.user.create({ data: { name: u.name, email: u.email } })
    )
  );
  console.log(`  ✓ ${users.length} users created`);

  // -------------------------------------------------------------------------
  // 3. Create betting room
  // -------------------------------------------------------------------------
  console.log("\n[3] Creating betting room…");
  const room = await db.room.create({
    data: {
      name: `${TEST_PREFIX}Group A Championship`,
      inviteCode: `${TEST_PREFIX}invite`,
      entryFee: ENTRY_FEE,
      status: "open",
      creatorId: users[0].id,
    },
  });
  await Promise.all(
    users.map((u) => db.roomMember.create({ data: { userId: u.id, roomId: room.id } }))
  );
  const totalPot = ENTRY_FEE * users.length;
  console.log(`  ✓ Room "${room.name}" (invite: ${room.inviteCode})`);
  console.log(`  ✓ ${users.length} members × ${fmt(ENTRY_FEE)} = ${fmt(totalPot)} total pot`);

  // -------------------------------------------------------------------------
  // 4. Find Group A matches in DB
  // -------------------------------------------------------------------------
  console.log("\n[4] Looking up Group A matches…");
  const matchRows = await db.match.findMany({
    where: { group: "A", round: "Group" },
    include: { homeTeam: true, awayTeam: true },
    orderBy: { matchNumber: "asc" },
  });

  const simMatchIds: string[] = [];
  for (const sim of SIM_MATCHES) {
    const row = matchRows.find(
      (m) =>
        m.homeTeam?.name === sim.homeTeam &&
        m.awayTeam?.name === sim.awayTeam
    );
    if (!row) {
      throw new Error(
        `Match ${sim.homeTeam} vs ${sim.awayTeam} not found in DB. ` +
        `Run: npx prisma db seed`
      );
    }
    simMatchIds.push(row.id);
    console.log(`  ✓ Match ${row.matchNumber}: ${row.homeTeam?.name} vs ${row.awayTeam?.name}`);
  }

  // -------------------------------------------------------------------------
  // 5. Submit predictions
  // -------------------------------------------------------------------------
  console.log("\n[5] Submitting predictions…");
  for (const user of users) {
    const preds = PREDICTIONS[user.name!];
    for (let i = 0; i < simMatchIds.length; i++) {
      await db.prediction.create({
        data: {
          userId: user.id,
          matchId: simMatchIds[i],
          roomId: room.id,
          homeScore: preds[i].home,
          awayScore: preds[i].away,
        },
      });
    }
  }
  console.log(`  ✓ ${users.length * simMatchIds.length} predictions submitted`);

  // -------------------------------------------------------------------------
  // 6. Create admin side bets
  // -------------------------------------------------------------------------
  console.log("\n[6] Creating side bets…");
  const sideBet1 = await db.sideBet.create({
    data: {
      roomId: room.id,
      title: "Who scores first in the tournament?",
      description: "Predict the first goal scorer",
      status: "open",
    },
  });
  const sideBet2 = await db.sideBet.create({
    data: {
      roomId: room.id,
      title: "How many goals in Group A total?",
      description: "Total goals across all 6 Group A matches",
      status: "open",
    },
  });

  // All users submit entries
  const sideBet1Answers = ["Pulisic", "Pulisic", "Ruiz", "Almada", "Larin"];
  const sideBet2Answers = ["8", "10", "8", "6", "12"];
  for (let i = 0; i < users.length; i++) {
    await db.sideBetEntry.create({
      data: { sideBetId: sideBet1.id, userId: users[i].id, answer: sideBet1Answers[i] },
    });
    await db.sideBetEntry.create({
      data: { sideBetId: sideBet2.id, userId: users[i].id, answer: sideBet2Answers[i] },
    });
  }
  console.log("  ✓ Side bet 1: Who scores first? (Pulisic is the correct answer)");
  console.log("  ✓ Side bet 2: Goals in Group A? (8 is the correct answer)");

  // -------------------------------------------------------------------------
  // 7. Create P2P bet
  // -------------------------------------------------------------------------
  console.log("\n[7] Creating P2P bet…");
  const p2pBet = await db.p2PSideBet.create({
    data: {
      roomId: room.id,
      proposerId: users[0].id,  // Alice proposes
      acceptorId: users[1].id,  // Bob accepts
      amount: 5,
      description: "USA wins Group A",
      status: "accepted",
    },
  });
  console.log(`  ✓ P2P bet: Alice vs Bob — "USA wins Group A" — ${fmt(p2pBet.amount)}`);

  // -------------------------------------------------------------------------
  // 8. Simulate match results
  // -------------------------------------------------------------------------
  console.log("\n[8] Simulating match results…");
  for (let i = 0; i < SIM_MATCHES.length; i++) {
    const sim = SIM_MATCHES[i];
    await db.match.update({
      where: { id: simMatchIds[i] },
      data: {
        homeScore: sim.actualHome,
        awayScore: sim.actualAway,
        status: "finished",
      },
    });
    console.log(`  ✓ ${sim.homeTeam} ${sim.actualHome}–${sim.actualAway} ${sim.awayTeam}`);
  }

  // -------------------------------------------------------------------------
  // 9. Score all predictions
  // -------------------------------------------------------------------------
  console.log("\n[9] Scoring predictions…");
  const allPredictions = await db.prediction.findMany({
    where: { roomId: room.id },
    include: { match: true },
  });

  let totalScored = 0;
  for (const pred of allPredictions) {
    const match = pred.match;
    if (
      match.status !== "finished" ||
      match.homeScore === null ||
      match.awayScore === null
    ) continue;

    const points = calculatePoints(
      match.round as Round,
      pred.homeScore,
      pred.awayScore,
      match.homeScore,
      match.awayScore
    );
    await db.prediction.update({ where: { id: pred.id }, data: { points } });
    totalScored++;
  }
  console.log(`  ✓ Scored ${totalScored} predictions`);

  // -------------------------------------------------------------------------
  // 10. Settle side bets
  // -------------------------------------------------------------------------
  console.log("\n[10] Settling side bets…");

  // Side bet 1: Pulisic scored first → Alice (index 0) and Bob (index 1) win
  const sb1WinnerEntry = await db.sideBetEntry.findFirst({
    where: { sideBetId: sideBet1.id, answer: "Pulisic", userId: users[0].id },
  });
  await db.sideBet.update({
    where: { id: sideBet1.id },
    data: { status: "settled", winnerEntryId: sb1WinnerEntry!.id },
  });
  console.log(`  ✓ Side bet 1 settled: "Pulisic" wins (Alice)`);

  // Side bet 2: 8 goals → Alice (index 0) and Charlie (index 2) win
  const sb2WinnerEntry = await db.sideBetEntry.findFirst({
    where: { sideBetId: sideBet2.id, answer: "8", userId: users[0].id },
  });
  await db.sideBet.update({
    where: { id: sideBet2.id },
    data: { status: "settled", winnerEntryId: sb2WinnerEntry!.id },
  });
  console.log(`  ✓ Side bet 2 settled: "8 goals" wins (Alice + Charlie)`);

  // P2P bet: USA did win Group A → Alice wins
  await db.p2PSideBet.update({
    where: { id: p2pBet.id },
    data: { status: "settled", winner: "proposer" },
  });
  console.log(`  ✓ P2P bet settled: Alice wins ${fmt(p2pBet.amount)}`);

  // -------------------------------------------------------------------------
  // 11. Print verification report
  // -------------------------------------------------------------------------
  console.log("\n");
  header("PAYOUT VERIFICATION REPORT");

  // --- Leaderboard ---
  const scoredPreds = await db.prediction.findMany({
    where: { roomId: room.id },
    include: { user: true, match: { include: { homeTeam: true, awayTeam: true } } },
    orderBy: [{ user: { name: "asc" } }, { match: { matchNumber: "asc" } }],
  });

  // Group by user
  const byUser = new Map<string, { name: string; totalPoints: number; breakdown: string[] }>();
  for (const pred of scoredPreds) {
    const uid = pred.userId;
    if (!byUser.has(uid)) {
      byUser.set(uid, { name: pred.user.name ?? uid, totalPoints: 0, breakdown: [] });
    }
    const entry = byUser.get(uid)!;
    const pts = pred.points ?? 0;
    entry.totalPoints += pts;
    const matchLabel = `${pred.match.homeTeam?.name ?? "?"} vs ${pred.match.awayTeam?.name ?? "?"}`;
    const actual = `${pred.match.homeScore}–${pred.match.awayScore}`;
    const predicted = `${pred.homeScore}–${pred.awayScore}`;
    entry.breakdown.push(`    ${matchLabel.padEnd(22)} pred ${predicted}  actual ${actual}  → ${pts} pts`);
  }

  const leaderboard = [...byUser.values()].sort((a, b) => b.totalPoints - a.totalPoints);

  console.log("\n  LEADERBOARD");
  sep();
  leaderboard.forEach((p, i) => {
    console.log(`  ${i + 1}. ${p.name.padEnd(25)} ${p.totalPoints} pts`);
    p.breakdown.forEach((l) => console.log(l));
  });

  // --- Pot distribution ---
  console.log("\n  POT DISTRIBUTION");
  sep();

  const totalPoints = leaderboard.reduce((s, p) => s + p.totalPoints, 0);
  console.log(`  Total pot:    ${fmt(totalPot)}`);
  console.log(`  Total points: ${totalPoints}`);
  console.log();

  if (totalPoints > 0) {
    leaderboard.forEach((p) => {
      const share = (p.totalPoints / totalPoints) * totalPot;
      console.log(`  ${p.name.padEnd(25)} ${p.totalPoints} pts → ${fmt(share)}`);
    });
  } else {
    console.log("  (no points scored — pot rolls over)");
  }

  // --- Side bets ---
  console.log("\n  SIDE BETS");
  sep();
  console.log("  Side bet 1 — 'Who scores first?'");
  console.log("  Correct: Pulisic  →  Winners: Alice, Bob  (2 of 5 players)");
  const sideBetWinnersCount = sideBet1Answers.filter((a) => a === "Pulisic").length;
  const sideBet1Prize = totalPot / 2 / sideBetWinnersCount; // hypothetical: half pot for side bets
  console.log(`  (If side bets split half the pot: ${fmt(totalPot / 2)} ÷ ${sideBetWinnersCount} = ${fmt(sideBet1Prize)} each)`);

  console.log();
  console.log("  Side bet 2 — 'How many goals in Group A?'");
  console.log("  Correct: 8  →  Winners: Alice, Charlie  (2 of 5 players)");

  // --- P2P bet ---
  console.log("\n  P2P BET");
  sep();
  console.log("  Alice vs Bob — 'USA wins Group A' — €5.00");
  console.log("  Result: Alice wins → Alice +€5.00, Bob -€5.00");

  // --- Summary ---
  console.log("\n  EARNINGS SUMMARY");
  sep();

  const potPerPoint = totalPoints > 0 ? totalPot / totalPoints : 0;
  const summaryRows: Array<{ name: string; potEarnings: number; p2pNet: number; total: number }> = leaderboard.map((p) => {
    const potEarnings = p.totalPoints * potPerPoint;
    const p2pNet =
      p.name.includes("Alice") ? 5 :
      p.name.includes("Bob")   ? -5 : 0;
    return { name: p.name, potEarnings, p2pNet, total: potEarnings + p2pNet };
  });

  console.log(`  ${"Name".padEnd(25)} ${"From pot".padStart(10)} ${"P2P".padStart(8)} ${"Total".padStart(10)}`);
  sep("-");
  summaryRows.forEach((r) => {
    console.log(
      `  ${r.name.padEnd(25)} ${fmt(r.potEarnings).padStart(10)} ${(r.p2pNet >= 0 ? "+" : "") + fmt(r.p2pNet).padStart(7)} ${fmt(r.total).padStart(10)}`
    );
  });

  const sumCheck = summaryRows.reduce((s, r) => s + r.potEarnings, 0);
  sep("-");
  console.log(`  ${"POT CHECK".padEnd(25)} ${fmt(sumCheck).padStart(10)}  (should equal ${fmt(totalPot)})`);
  const ok = Math.abs(sumCheck - totalPot) < 0.01;
  console.log(`  ${ok ? "✓ Pot math checks out!" : "✗ POT MATH ERROR — investigate"}`);

  // -------------------------------------------------------------------------
  // 12. Cleanup
  // -------------------------------------------------------------------------
  console.log("\n\n[12] Cleaning up test data…");
  const testUserIds = users.map((u) => u.id);
  await db.prediction.deleteMany({ where: { userId: { in: testUserIds } } });
  await db.sideBetEntry.deleteMany({ where: { userId: { in: testUserIds } } });
  await db.p2PSideBet.deleteMany({ where: { proposerId: { in: testUserIds } } });
  await db.roomMember.deleteMany({ where: { userId: { in: testUserIds } } });
  await db.sideBet.deleteMany({ where: { roomId: room.id } });
  await db.room.delete({ where: { id: room.id } });
  await db.user.deleteMany({ where: { id: { in: testUserIds } } });
  // Reset match scores/status
  for (let i = 0; i < simMatchIds.length; i++) {
    await db.match.update({
      where: { id: simMatchIds[i] },
      data: { homeScore: null, awayScore: null, status: "scheduled" },
    });
  }
  console.log("  ✓ All test data removed, matches reset to scheduled");

  console.log("\n");
  sep("═");
  console.log("  Test tournament complete.");
  sep("═");
  console.log();
}

main()
  .catch((err) => {
    console.error("\n[ERROR]", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
