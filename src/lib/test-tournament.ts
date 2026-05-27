/**
 * Core logic for the test tournament feature.
 * Used by both the admin UI (via API route) and the CLI script.
 */

import { db } from "@/lib/db";
import { calculatePoints, type Round } from "@/lib/points";

export const TEST_PREFIX = "test-tournament-";
const TEST_ROOM_INVITE = `${TEST_PREFIX}invite`;

export type LeaderboardEntry = {
  name: string;
  points: number;
  breakdown: Array<{ matchLabel: string; predicted: string; actual: string; pts: number }>;
};

export type TestTournamentReport = {
  roomId: string;
  roomName: string;
  leaderboard: LeaderboardEntry[];
  matches: Array<{ homeTeam: string; awayTeam: string; score: string }>;
  potTotal: number;
};

// ---------------------------------------------------------------------------
// Test scenario data
// ---------------------------------------------------------------------------

const TEST_USERS = [
  { name: "Alice (perfect)",      email: `${TEST_PREFIX}alice@test.local` },
  { name: "Bob (right result)",   email: `${TEST_PREFIX}bob@test.local` },
  { name: "Charlie (mixed)",      email: `${TEST_PREFIX}charlie@test.local` },
  { name: "Diana (mostly wrong)", email: `${TEST_PREFIX}diana@test.local` },
  { name: "Eve (all wrong)",      email: `${TEST_PREFIX}eve@test.local` },
];

const ENTRY_FEE = 10;

const SIM_MATCHES = [
  { homeTeam: "USA",    awayTeam: "Panama",   actualHome: 2, actualAway: 0 },
  { homeTeam: "USA",    awayTeam: "Honduras",  actualHome: 1, actualAway: 1 },
  { homeTeam: "Panama", awayTeam: "Honduras",  actualHome: 0, actualAway: 1 },
] as const;

const PREDICTIONS: Record<string, Array<{ home: number; away: number }>> = {
  "Alice (perfect)":      [{ home: 2, away: 0 }, { home: 1, away: 1 }, { home: 0, away: 1 }],
  "Bob (right result)":   [{ home: 1, away: 0 }, { home: 2, away: 2 }, { home: 0, away: 2 }],
  "Charlie (mixed)":      [{ home: 2, away: 0 }, { home: 0, away: 0 }, { home: 1, away: 0 }],
  "Diana (mostly wrong)": [{ home: 0, away: 2 }, { home: 1, away: 0 }, { home: 1, away: 0 }],
  "Eve (all wrong)":      [{ home: 0, away: 1 }, { home: 0, away: 2 }, { home: 2, away: 0 }],
};

// ---------------------------------------------------------------------------
// Status check
// ---------------------------------------------------------------------------

export async function getTestTournamentStatus(): Promise<{ exists: boolean; roomId?: string }> {
  const room = await db.room.findUnique({ where: { inviteCode: TEST_ROOM_INVITE } });
  return room ? { exists: true, roomId: room.id } : { exists: false };
}

// ---------------------------------------------------------------------------
// Seed + simulate (leaves data in DB)
// ---------------------------------------------------------------------------

export async function runTestTournament(adminUserId?: string): Promise<TestTournamentReport> {
  // Cleanup any leftover data first
  await cleanupTestTournament();

  // 1. Create test users
  const users = await Promise.all(
    TEST_USERS.map((u) => db.user.create({ data: { name: u.name, email: u.email } }))
  );

  // 2. Create room and add test users + the admin as member
  const room = await db.room.create({
    data: {
      name: `${TEST_PREFIX}Group A Demo`,
      inviteCode: TEST_ROOM_INVITE,
      entryFee: ENTRY_FEE,
      status: "active",
      creatorId: adminUserId ?? null,
    },
  });

  const memberIds = [...users.map((u) => u.id), ...(adminUserId ? [adminUserId] : [])];
  await Promise.all(
    memberIds.map((uid) =>
      db.roomMember.create({ data: { userId: uid, roomId: room.id } })
    )
  );

  // 3. Look up Group A matches
  const matchRows = await db.match.findMany({
    where: { group: "A", round: "Group" },
    include: { homeTeam: true, awayTeam: true },
    orderBy: { matchNumber: "asc" },
  });

  const simMatchIds: string[] = [];
  for (const sim of SIM_MATCHES) {
    const row = matchRows.find(
      (m) => m.homeTeam?.name === sim.homeTeam && m.awayTeam?.name === sim.awayTeam
    );
    if (!row) throw new Error(`Match ${sim.homeTeam} vs ${sim.awayTeam} not found — run db:seed first`);
    simMatchIds.push(row.id);
  }

  // 4. Submit predictions for each test user
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

  // 5. Create admin side bets
  const sideBet1 = await db.sideBet.create({
    data: { roomId: room.id, title: "Who scores first?", status: "open" },
  });
  const sideBet2 = await db.sideBet.create({
    data: { roomId: room.id, title: "Goals in Group A total?", status: "open" },
  });

  const sb1Answers = ["Pulisic", "Pulisic", "Ruiz", "Almada", "Larin"];
  const sb2Answers = ["8", "10", "8", "6", "12"];
  for (let i = 0; i < users.length; i++) {
    await db.sideBetEntry.create({
      data: { sideBetId: sideBet1.id, userId: users[i].id, answer: sb1Answers[i] },
    });
    await db.sideBetEntry.create({
      data: { sideBetId: sideBet2.id, userId: users[i].id, answer: sb2Answers[i] },
    });
  }

  // Settle side bets
  const sb1Winner = await db.sideBetEntry.findFirst({
    where: { sideBetId: sideBet1.id, answer: "Pulisic", userId: users[0].id },
  });
  await db.sideBet.update({
    where: { id: sideBet1.id },
    data: { status: "settled", winnerEntryId: sb1Winner!.id },
  });
  const sb2Winner = await db.sideBetEntry.findFirst({
    where: { sideBetId: sideBet2.id, answer: "8", userId: users[0].id },
  });
  await db.sideBet.update({
    where: { id: sideBet2.id },
    data: { status: "settled", winnerEntryId: sb2Winner!.id },
  });

  // 6. Create P2P bet (Alice vs Bob)
  await db.p2PSideBet.create({
    data: {
      roomId: room.id,
      proposerId: users[0].id,
      acceptorId: users[1].id,
      amount: 5,
      description: "USA wins Group A",
      status: "settled",
      winner: "proposer",
    },
  });

  // 7. Simulate match results
  for (let i = 0; i < SIM_MATCHES.length; i++) {
    const sim = SIM_MATCHES[i];
    await db.match.update({
      where: { id: simMatchIds[i] },
      data: { homeScore: sim.actualHome, awayScore: sim.actualAway, status: "finished" },
    });
  }

  // 8. Score predictions
  const allPredictions = await db.prediction.findMany({
    where: { roomId: room.id },
    include: { match: { include: { homeTeam: true, awayTeam: true } } },
  });

  for (const pred of allPredictions) {
    const m = pred.match;
    if (m.status !== "finished" || m.homeScore === null || m.awayScore === null) continue;
    const points = calculatePoints(
      m.round as Round,
      pred.homeScore,
      pred.awayScore,
      m.homeScore,
      m.awayScore
    );
    await db.prediction.update({ where: { id: pred.id }, data: { points } });
  }

  return buildReport(room.id);
}

// ---------------------------------------------------------------------------
// Build report from existing DB state
// ---------------------------------------------------------------------------

export async function buildReport(roomId: string): Promise<TestTournamentReport> {
  const room = await db.room.findUniqueOrThrow({
    where: { id: roomId },
    include: { members: true },
  });

  const predictions = await db.prediction.findMany({
    where: { roomId },
    include: {
      user: true,
      match: { include: { homeTeam: true, awayTeam: true } },
    },
  });

  // Filter to only test users
  const byUser = new Map<string, LeaderboardEntry>();
  for (const pred of predictions) {
    if (!pred.user.email?.startsWith(TEST_PREFIX)) continue;
    const uid = pred.userId;
    if (!byUser.has(uid)) {
      byUser.set(uid, { name: pred.user.name ?? uid, points: 0, breakdown: [] });
    }
    const entry = byUser.get(uid)!;
    const pts = pred.points ?? 0;
    entry.points += pts;
    const homeTeam = pred.match.homeTeam?.name ?? "?";
    const awayTeam = pred.match.awayTeam?.name ?? "?";
    entry.breakdown.push({
      matchLabel: `${homeTeam} vs ${awayTeam}`,
      predicted: `${pred.homeScore}–${pred.awayScore}`,
      actual:
        pred.match.homeScore !== null && pred.match.awayScore !== null
          ? `${pred.match.homeScore}–${pred.match.awayScore}`
          : "—",
      pts,
    });
  }

  const leaderboard = [...byUser.values()].sort((a, b) => b.points - a.points);

  const matchRows = await db.match.findMany({
    where: { group: "A", round: "Group", status: "finished" },
    include: { homeTeam: true, awayTeam: true },
    orderBy: { matchNumber: "asc" },
    take: 3,
  });

  const matches = matchRows.map((m) => ({
    homeTeam: m.homeTeam?.name ?? "?",
    awayTeam: m.awayTeam?.name ?? "?",
    score: `${m.homeScore}–${m.awayScore}`,
  }));

  // Only count test users for pot (admin was added as observer)
  const testMemberCount = TEST_USERS.length;
  const potTotal = room.entryFee * testMemberCount;

  return { roomId, roomName: room.name, leaderboard, matches, potTotal };
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export async function cleanupTestTournament(): Promise<void> {
  const room = await db.room.findUnique({ where: { inviteCode: TEST_ROOM_INVITE } });

  if (room) {
    // Reset match scores first
    const predictions = await db.prediction.findMany({ where: { roomId: room.id }, include: { match: true } });
    const matchIds = [...new Set(predictions.map((p) => p.matchId))];
    for (const matchId of matchIds) {
      await db.match.update({
        where: { id: matchId },
        data: { homeScore: null, awayScore: null, status: "scheduled" },
      });
    }

    await db.sideBetEntry.deleteMany({ where: { sideBet: { roomId: room.id } } });
    await db.sideBet.deleteMany({ where: { roomId: room.id } });
    await db.p2PSideBet.deleteMany({ where: { roomId: room.id } });
    await db.prediction.deleteMany({ where: { roomId: room.id } });
    await db.roomMember.deleteMany({ where: { roomId: room.id } });
    await db.room.delete({ where: { id: room.id } });
  }

  const testUsers = await db.user.findMany({
    where: { email: { startsWith: TEST_PREFIX } },
    select: { id: true },
  });
  if (testUsers.length > 0) {
    await db.user.deleteMany({ where: { id: { in: testUsers.map((u) => u.id) } } });
  }
}
