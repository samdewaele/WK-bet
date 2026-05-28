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
  potTotal: number;
};

const TEST_USERS = [
  { name: "Alice",   email: `${TEST_PREFIX}alice@test.local` },
  { name: "Bob",     email: `${TEST_PREFIX}bob@test.local` },
  { name: "Charlie", email: `${TEST_PREFIX}charlie@test.local` },
  { name: "Diana",   email: `${TEST_PREFIX}diana@test.local` },
  { name: "Eve",     email: `${TEST_PREFIX}eve@test.local` },
];

const ENTRY_FEE = 10;

function randomGoals(): number {
  const r = Math.random();
  if (r < 0.28) return 0;
  if (r < 0.60) return 1;
  if (r < 0.82) return 2;
  if (r < 0.95) return 3;
  return 4;
}

// ---------------------------------------------------------------------------
// Status check
// ---------------------------------------------------------------------------

export async function getTestTournamentStatus(): Promise<{ exists: boolean; roomId?: string }> {
  const room = await db.room.findUnique({ where: { inviteCode: TEST_ROOM_INVITE } });
  return room ? { exists: true, roomId: room.id } : { exists: false };
}

// ---------------------------------------------------------------------------
// Standalone test room (CLI / platform admin)
// ---------------------------------------------------------------------------

export async function runTestTournament(adminUserId?: string): Promise<TestTournamentReport> {
  await cleanupTestTournament();

  const users = await Promise.all(
    TEST_USERS.map((u) => db.user.create({ data: { name: u.name, email: u.email } }))
  );

  const room = await db.room.create({
    data: {
      name: `${TEST_PREFIX}Full Group Stage Demo`,
      inviteCode: TEST_ROOM_INVITE,
      entryFee: ENTRY_FEE,
      status: "active",
      creatorId: adminUserId ?? null,
    },
  });

  const memberIds = [...users.map((u) => u.id), ...(adminUserId ? [adminUserId] : [])];
  await Promise.all(memberIds.map((uid) => db.roomMember.create({ data: { userId: uid, roomId: room.id } })));

  await _seedGroupStageRandomly(room.id, users);

  return buildReport(room.id);
}

// ---------------------------------------------------------------------------
// Room-scoped seed (group admin UI)
// ---------------------------------------------------------------------------

export async function getTestInRoomStatus(roomId: string): Promise<boolean> {
  const testEmails = TEST_USERS.map((u) => u.email);
  const count = await db.roomMember.count({
    where: { roomId, user: { email: { in: testEmails } } },
  });
  return count > 0;
}

export async function seedIntoRoom(roomId: string): Promise<TestTournamentReport> {
  await cleanupTestInRoom(roomId);

  const users = await Promise.all(
    TEST_USERS.map((u) =>
      db.user.upsert({
        where: { email: u.email },
        create: { name: u.name, email: u.email },
        update: { name: u.name },
      })
    )
  );

  for (const user of users) {
    await db.roomMember.upsert({
      where: { userId_roomId: { userId: user.id, roomId } },
      create: { userId: user.id, roomId },
      update: {},
    });
  }

  await _seedGroupStageRandomly(roomId, users);

  return buildReport(roomId);
}

// ---------------------------------------------------------------------------
// Core: random group stage simulation (shared by both entry points)
// ---------------------------------------------------------------------------

async function _seedGroupStageRandomly(
  roomId: string,
  users: { id: string; name: string | null }[]
): Promise<void> {
  const groupMatches = await db.match.findMany({
    where: { round: "Group" },
    include: { homeTeam: true, awayTeam: true },
    orderBy: { matchNumber: "asc" },
  });

  if (groupMatches.length === 0) {
    throw new Error("No group matches found — run db:seed first");
  }

  // Generate random results for every group match
  const results = groupMatches.map((m) => ({
    matchId: m.id,
    home: randomGoals(),
    away: randomGoals(),
  }));

  // Create predictions for each test user (random guesses)
  const userPredictions = users.map((user) => ({
    userId: user.id,
    preds: results.map(() => ({ home: randomGoals(), away: randomGoals() })),
  }));

  for (const { userId, preds } of userPredictions) {
    for (let i = 0; i < groupMatches.length; i++) {
      await db.prediction.upsert({
        where: { userId_matchId_roomId: { userId, matchId: groupMatches[i].id, roomId } },
        create: { userId, matchId: groupMatches[i].id, roomId, homeScore: preds[i].home, awayScore: preds[i].away },
        update: { homeScore: preds[i].home, awayScore: preds[i].away, points: null },
      });
    }
  }

  // Apply match results
  for (const { matchId, home, away } of results) {
    await db.match.update({
      where: { id: matchId },
      data: { homeScore: home, awayScore: away, status: "finished" },
    });
  }

  // Score predictions
  const allPreds = await db.prediction.findMany({
    where: { roomId, userId: { in: users.map((u) => u.id) } },
    include: { match: true },
  });

  await Promise.all(
    allPreds.map((pred) => {
      const m = pred.match;
      if (m.homeScore === null || m.awayScore === null) return null;
      const pts = calculatePoints(m.round as Round, pred.homeScore, pred.awayScore, m.homeScore, m.awayScore);
      return db.prediction.update({ where: { id: pred.id }, data: { points: pts } });
    }).filter(Boolean)
  );
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export async function buildReport(roomId: string): Promise<TestTournamentReport> {
  const room = await db.room.findUniqueOrThrow({ where: { id: roomId } });

  const predictions = await db.prediction.findMany({
    where: { roomId },
    include: {
      user: true,
      match: { include: { homeTeam: true, awayTeam: true } },
    },
  });

  const byUser = new Map<string, LeaderboardEntry>();
  for (const pred of predictions) {
    if (!pred.user.email?.startsWith(TEST_PREFIX)) continue;
    const entry = byUser.get(pred.userId) ?? { name: pred.user.name ?? pred.userId, points: 0, breakdown: [] };
    entry.points += pred.points ?? 0;
    entry.breakdown.push({
      matchLabel: `${pred.match.homeTeam?.name ?? "?"} vs ${pred.match.awayTeam?.name ?? "?"}`,
      predicted: `${pred.homeScore}–${pred.awayScore}`,
      actual: pred.match.homeScore !== null ? `${pred.match.homeScore}–${pred.match.awayScore}` : "—",
      pts: pred.points ?? 0,
    });
    byUser.set(pred.userId, entry);
  }

  const leaderboard = [...byUser.values()].sort((a, b) => b.points - a.points);
  const potTotal = room.entryFee * TEST_USERS.length;

  return { roomId, roomName: room.name, leaderboard, potTotal };
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export async function cleanupTestInRoom(roomId: string): Promise<void> {
  const testEmails = TEST_USERS.map((u) => u.email);
  const testUsers = await db.user.findMany({
    where: { email: { in: testEmails } },
    select: { id: true },
  });
  if (testUsers.length === 0) return;

  const ids = testUsers.map((u) => u.id);

  // Reset group match scores we touched
  await db.match.updateMany({
    where: { round: "Group", status: "finished" },
    data: { homeScore: null, awayScore: null, status: "scheduled" },
  });

  await db.prediction.deleteMany({ where: { roomId, userId: { in: ids } } });
  await db.roomMember.deleteMany({ where: { roomId, userId: { in: ids } } });

  for (const id of ids) {
    const remaining = await db.roomMember.count({ where: { userId: id } });
    if (remaining === 0) await db.user.delete({ where: { id } });
  }
}

export async function cleanupTestTournament(): Promise<void> {
  const room = await db.room.findUnique({ where: { inviteCode: TEST_ROOM_INVITE } });

  if (room) {
    await db.match.updateMany({
      where: { round: "Group", status: "finished" },
      data: { homeScore: null, awayScore: null, status: "scheduled" },
    });
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
