/**
 * Core logic for the test tournament feature.
 * Simulates a full WC tournament: group stage + KO rounds + Uber Pot bets.
 */

import { db } from "@/lib/db";
import { calculatePoints, type Round } from "@/lib/points";
import {
  calculatePot,
  scoreGroupStanding,
  earnedFromGroupStanding,
  earnedFromKOMatch,
  KO_ROUNDS,
  type KORound,
} from "@/lib/pot";

export const TEST_PREFIX = "test-tournament-";
const TEST_ROOM_INVITE = `${TEST_PREFIX}invite`;

export type LeaderboardEntry = {
  name: string;
  points: number;
  earned: number;
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

const UBER_POT_BETS = [
  { title: "Who wins the Golden Boot?",              desc: "Top scorer of the tournament" },
  { title: "How many total goals in group stage?",   desc: "All 48 group matches combined" },
  { title: "Which team scores the most in groups?",  desc: null },
  { title: "Which team gets the first red card?",    desc: null },
];

const UBER_POT_ANSWERS = [
  ["Mbappé",  "Haaland", "Salah",   "Vinicius", "Kane"],
  ["142",     "138",     "142",     "130",      "151"],
  ["Brazil",  "France",  "Brazil",  "Spain",    "Germany"],
  ["Uruguay", "Germany", "Uruguay", "Argentina","Italy"],
];

// ---------------------------------------------------------------------------
// Random helpers
// ---------------------------------------------------------------------------

function randomGoals(): number {
  const r = Math.random();
  if (r < 0.28) return 0;
  if (r < 0.60) return 1;
  if (r < 0.82) return 2;
  if (r < 0.95) return 3;
  return 4;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------------------------------------------------------------
// Status checks
// ---------------------------------------------------------------------------

export async function getTestTournamentStatus(): Promise<{ exists: boolean; roomId?: string }> {
  const room = await db.room.findUnique({ where: { inviteCode: TEST_ROOM_INVITE } });
  return room ? { exists: true, roomId: room.id } : { exists: false };
}

export async function getTestInRoomStatus(roomId: string): Promise<boolean> {
  const testEmails = TEST_USERS.map((u) => u.email);
  const count = await db.roomMember.count({
    where: { roomId, user: { email: { in: testEmails } } },
  });
  return count > 0;
}

export async function getTestPhase(roomId: string): Promise<0 | 1 | 2> {
  const seeded = await getTestInRoomStatus(roomId);
  if (!seeded) return 0;

  const testEmails = TEST_USERS.map((u) => u.email);
  const testUsers = await db.user.findMany({ where: { email: { in: testEmails } }, select: { id: true } });
  if (testUsers.length === 0) return 0;

  const koPredCount = await db.prediction.count({
    where: {
      roomId,
      userId: { in: testUsers.map((u) => u.id) },
      match: { round: { not: "Group" } },
    },
  });
  return koPredCount > 0 ? 2 : 1;
}

// ---------------------------------------------------------------------------
// Standalone test room (CLI)
// ---------------------------------------------------------------------------

export async function runTestTournament(adminUserId?: string): Promise<TestTournamentReport> {
  await cleanupTestTournament();

  const users = await Promise.all(
    TEST_USERS.map((u) => db.user.create({ data: { name: u.name, email: u.email } }))
  );

  const room = await db.room.create({
    data: {
      name: `${TEST_PREFIX}Full Tournament Demo`,
      inviteCode: TEST_ROOM_INVITE,
      entryFee: ENTRY_FEE,
      status: "active",
      creatorId: adminUserId ?? null,
    },
  });

  const memberIds = [...users.map((u) => u.id), ...(adminUserId ? [adminUserId] : [])];
  await Promise.all(memberIds.map((uid) => db.roomMember.create({ data: { userId: uid, roomId: room.id } })));

  const memberCount = memberIds.length;
  await _simulate(room.id, users, ENTRY_FEE, memberCount);

  return buildReport(room.id);
}

// ---------------------------------------------------------------------------
// Room-scoped seed (admin UI) — two-phase
// ---------------------------------------------------------------------------

export async function seedGroupStageInRoom(roomId: string): Promise<TestTournamentReport> {
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

  const room = await db.room.findUniqueOrThrow({ where: { id: roomId } });
  const memberCount = await db.roomMember.count({ where: { roomId } });

  const hasRealResults = await db.match.count({ where: { status: "finished" } });
  if (hasRealResults > 0) {
    throw new Error(
      "Cannot simulate: the real tournament already has scored matches. " +
      "Run cleanup first, or only use this before tournament kick-off."
    );
  }

  await _seedGroupStageRandomly(roomId, users, room.entryFee, memberCount);
  return buildReport(roomId);
}

export async function seedKOStageInRoom(roomId: string): Promise<TestTournamentReport> {
  const phase = await getTestPhase(roomId);
  if (phase === 0) throw new Error("Run Phase 1 (Group Stage) first");

  const testEmails = TEST_USERS.map((u) => u.email);
  const users = await db.user.findMany({
    where: { email: { in: testEmails } },
    select: { id: true, name: true },
  });
  if (users.length === 0) throw new Error("Test users not found — run Phase 1 first");

  const room = await db.room.findUniqueOrThrow({ where: { id: roomId } });
  const memberCount = await db.roomMember.count({ where: { roomId } });

  await _seedKORoundsRandomly(roomId, users, room.entryFee, memberCount);
  await _seedUberPotBets(roomId, users);

  return buildReport(roomId);
}

export async function seedIntoRoom(roomId: string): Promise<TestTournamentReport> {
  await seedGroupStageInRoom(roomId);
  return seedKOStageInRoom(roomId);
}

// ---------------------------------------------------------------------------
// Core simulation — group stage + KO + Uber Pot bets
// ---------------------------------------------------------------------------

async function _simulate(
  roomId: string,
  users: { id: string; name: string | null }[],
  entryFee: number,
  memberCount: number,
): Promise<void> {
  // Refuse to run if real match results already exist — cleanup would wipe them
  const hasRealResults = await db.match.count({ where: { status: "finished" } });
  if (hasRealResults > 0) {
    throw new Error(
      "Cannot simulate: the real tournament already has scored matches. " +
      "Run cleanup first, or only use this before tournament kick-off."
    );
  }
  await _seedGroupStageRandomly(roomId, users, entryFee, memberCount);
  await _seedKORoundsRandomly(roomId, users, entryFee, memberCount);
  await _seedUberPotBets(roomId, users);
}

// ---------------------------------------------------------------------------
// Group stage: match results + standing predictions
// ---------------------------------------------------------------------------

async function _seedGroupStageRandomly(
  roomId: string,
  users: { id: string; name: string | null }[],
  entryFee: number,
  memberCount: number,
): Promise<void> {
  const groupMatches = await db.match.findMany({
    where: { round: "Group" },
    include: { homeTeam: true, awayTeam: true },
    orderBy: { matchNumber: "asc" },
  });
  if (groupMatches.length === 0) throw new Error("No group matches found — run db:seed first");

  // Random results for all 48 group matches
  const results = groupMatches.map((m) => ({ matchId: m.id, home: randomGoals(), away: randomGoals() }));

  // Random match predictions per user
  for (const user of users) {
    const preds = results.map(() => ({ home: randomGoals(), away: randomGoals() }));
    for (let i = 0; i < groupMatches.length; i++) {
      await db.prediction.upsert({
        where: { userId_matchId_roomId: { userId: user.id, matchId: groupMatches[i].id, roomId } },
        create: { userId: user.id, matchId: groupMatches[i].id, roomId, homeScore: preds[i].home, awayScore: preds[i].away },
        update: { homeScore: preds[i].home, awayScore: preds[i].away, points: null, earnedAmount: null },
      });
    }
  }

  // Apply match results
  for (const { matchId, home, away } of results) {
    await db.match.update({ where: { id: matchId }, data: { homeScore: home, awayScore: away, status: "finished" } });
  }

  // Score group match predictions for ALL room members:
  // test users store preds with roomId, real members store with roomId: null
  const allRoomMemberIds = (await db.roomMember.findMany({
    where: { roomId },
    select: { userId: true },
  })).map((m) => m.userId);

  const allPreds = await db.prediction.findMany({
    where: {
      userId: { in: allRoomMemberIds },
      match: { round: "Group" },
      OR: [{ roomId }, { roomId: null }],
    },
    include: { match: true },
  });
  await Promise.all(
    allPreds
      .filter((p) => p.match.homeScore !== null)
      .map((pred) => {
        const pts = calculatePoints("Group", pred.homeScore, pred.awayScore, pred.match.homeScore!, pred.match.awayScore!);
        return db.prediction.update({ where: { id: pred.id }, data: { points: pts } });
      })
  );

  // Compute actual group standings from results
  const actualStandings = _computeActualStandings(groupMatches.map((m, i) => ({
    homeTeamId: m.homeTeamId,
    awayTeamId: m.awayTeamId,
    group: m.group,
    homeScore: results[i].home,
    awayScore: results[i].away,
  })));

  // Group standing predictions + earnedAmount
  const pot = calculatePot(entryFee, memberCount);
  const prizePerGroup = pot.groupStagePot / 12;
  const teams = await db.team.findMany({ select: { id: true, group: true } });
  const groups = [...new Set(teams.map((t) => t.group!).filter(Boolean))].sort();

  for (const group of groups) {
    const groupTeams = teams.filter((t) => t.group === group).map((t) => t.id);
    if (groupTeams.length < 4) continue;
    const actual = actualStandings.get(group) ?? groupTeams;

    // Test users get random predictions
    const userPreds: { userId: string; predicted: string[] }[] = users.map((u) => ({
      userId: u.id,
      predicted: shuffle(groupTeams).slice(0, 4),
    }));

    for (const up of userPreds) {
      await db.groupStandingPrediction.upsert({
        where: { userId_roomId_wcGroup: { userId: up.userId, roomId, wcGroup: group } },
        create: { userId: up.userId, roomId, wcGroup: group, position1: up.predicted[0], position2: up.predicted[1], position3: up.predicted[2], position4: up.predicted[3] },
        update: { position1: up.predicted[0], position2: up.predicted[1], position3: up.predicted[2], position4: up.predicted[3], earnedAmount: null },
      });
    }

    // Score and set earnedAmount for ALL members who submitted a standing prediction for this group
    const p4 = (p: string[]) => [p[0], p[1], p[2], p[3]] as [string, string, string, string];
    const a4 = p4(actual.slice(0, 4));

    const allGroupPreds = await db.groupStandingPrediction.findMany({
      where: { roomId, wcGroup: group },
    });
    const allScored = allGroupPreds.map((gp) => ({
      userId: gp.userId,
      predicted: [gp.position1, gp.position2, gp.position3, gp.position4],
      multiplier: scoreGroupStanding(
        [gp.position1, gp.position2, gp.position3, gp.position4] as [string, string, string, string],
        a4
      ).scoreMultiplier,
    }));
    const byMultiplier = new Map<number, number>();
    for (const s of allScored) byMultiplier.set(s.multiplier, (byMultiplier.get(s.multiplier) ?? 0) + 1);

    for (const s of allScored) {
      const winnersCount = byMultiplier.get(s.multiplier) ?? 1;
      const earnedAmount = earnedFromGroupStanding(
        s.predicted as [string, string, string, string],
        a4,
        prizePerGroup,
        s.multiplier > 0 ? winnersCount : 0
      );
      await db.groupStandingPrediction.update({
        where: { userId_roomId_wcGroup: { userId: s.userId, roomId, wcGroup: group } },
        data: { earnedAmount },
      });
    }
  }
}

function _computeActualStandings(
  matches: { homeTeamId: string | null; awayTeamId: string | null; group: string | null; homeScore: number; awayScore: number }[]
): Map<string, string[]> {
  const standings = new Map<string, Map<string, { pts: number; gd: number; gf: number }>>();

  for (const m of matches) {
    if (!m.homeTeamId || !m.awayTeamId || !m.group) continue;
    if (!standings.has(m.group)) standings.set(m.group, new Map());
    const g = standings.get(m.group)!;
    if (!g.has(m.homeTeamId)) g.set(m.homeTeamId, { pts: 0, gd: 0, gf: 0 });
    if (!g.has(m.awayTeamId)) g.set(m.awayTeamId, { pts: 0, gd: 0, gf: 0 });

    const home = g.get(m.homeTeamId)!;
    const away = g.get(m.awayTeamId)!;
    const gd = m.homeScore - m.awayScore;
    home.gf += m.homeScore; away.gf += m.awayScore;
    home.gd += gd; away.gd -= gd;
    if (m.homeScore > m.awayScore) home.pts += 3;
    else if (m.homeScore < m.awayScore) away.pts += 3;
    else { home.pts += 1; away.pts += 1; }
  }

  const result = new Map<string, string[]>();
  for (const [group, teamMap] of standings.entries()) {
    const sorted = [...teamMap.entries()]
      .sort((a, b) => b[1].pts - a[1].pts || b[1].gd - a[1].gd || b[1].gf - a[1].gf)
      .map(([id]) => id);
    result.set(group, sorted);
  }
  return result;
}

// ---------------------------------------------------------------------------
// KO rounds: random results + predictions with earnedAmount
// ---------------------------------------------------------------------------

async function _seedKORoundsRandomly(
  roomId: string,
  users: { id: string; name: string | null }[],
  entryFee: number,
  memberCount: number,
): Promise<void> {
  const pot = calculatePot(entryFee, memberCount);

  const koMatches = await db.match.findMany({
    where: { round: { in: [...KO_ROUNDS] } },
    orderBy: { matchNumber: "asc" },
  });
  if (koMatches.length === 0) return;

  // Random results + predictions for each KO match
  for (const match of koMatches) {
    let actualHome = randomGoals();
    // KO can't draw — if drawn, home wins on penalties (represented as +1)
    const actualAway = randomGoals();
    if (actualHome === actualAway) actualHome += 1; // KO can't draw — home wins by 1

    await db.match.update({
      where: { id: match.id },
      data: { homeScore: actualHome, awayScore: actualAway, status: "finished" },
    });

    // Create random predictions for test users
    const userPreds = users.map((u) => ({ userId: u.id, home: randomGoals(), away: randomGoals() }));
    for (const pred of userPreds) {
      await db.prediction.upsert({
        where: { userId_matchId_roomId: { userId: pred.userId, matchId: match.id, roomId } },
        create: { userId: pred.userId, matchId: match.id, roomId, homeScore: pred.home, awayScore: pred.away },
        update: { homeScore: pred.home, awayScore: pred.away, points: null, earnedAmount: null },
      });
    }

    // Score ALL predictions for this match (test users + real members who submitted)
    const matchPrize = pot.prizePerKOMatch[match.round as KORound] ?? 0;
    const allMatchPreds = await db.prediction.findMany({
      where: { matchId: match.id, roomId },
    });

    const scored = allMatchPreds.map((pred) => {
      const scoreMultiplier = (() => {
        if (pred.homeScore === actualHome && pred.awayScore === actualAway) return 1.0;
        const pWin = pred.homeScore > pred.awayScore ? "home" : pred.homeScore < pred.awayScore ? "away" : "draw";
        const aWin = actualHome > actualAway ? "home" : actualHome < actualAway ? "away" : "draw";
        return pWin === aWin ? 0.75 : 0;
      })();
      const pts = calculatePoints(match.round as Round, pred.homeScore, pred.awayScore, actualHome, actualAway);
      return { id: pred.id, homeScore: pred.homeScore, awayScore: pred.awayScore, scoreMultiplier, pts };
    });

    const byMultiplier = new Map<number, number>();
    for (const s of scored) {
      if (s.scoreMultiplier > 0) byMultiplier.set(s.scoreMultiplier, (byMultiplier.get(s.scoreMultiplier) ?? 0) + 1);
    }

    await Promise.all(
      scored.map((s) => {
        const winnersCount = byMultiplier.get(s.scoreMultiplier) ?? 0;
        const earnedAmount = earnedFromKOMatch(s.homeScore, s.awayScore, actualHome, actualAway, matchPrize, winnersCount);
        return db.prediction.update({ where: { id: s.id }, data: { points: s.pts, earnedAmount } });
      })
    );
  }
}

// ---------------------------------------------------------------------------
// Uber Pot bets
// ---------------------------------------------------------------------------

async function _seedUberPotBets(roomId: string, users: { id: string }[]): Promise<void> {
  // Remove any existing test bets in this room
  const testBets = await db.sideBet.findMany({
    where: { roomId, proposedByUserId: { in: users.map((u) => u.id) } },
    select: { id: true },
  });
  if (testBets.length > 0) {
    await db.sideBetEntry.deleteMany({ where: { sideBetId: { in: testBets.map((b) => b.id) } } });
    await db.sideBet.deleteMany({ where: { id: { in: testBets.map((b) => b.id) } } });
  }

  for (let i = 0; i < UBER_POT_BETS.length; i++) {
    const bet = UBER_POT_BETS[i];
    const isLast = i === UBER_POT_BETS.length - 1;

    const sideBet = await db.sideBet.create({
      data: {
        roomId,
        proposedByUserId: users[0].id,
        title: bet.title,
        description: bet.desc,
        status: isLast ? "open" : "settled",
      },
    });

    const entries = await Promise.all(
      users.map((u, j) =>
        db.sideBetEntry.create({
          data: { sideBetId: sideBet.id, userId: u.id, answer: UBER_POT_ANSWERS[i][j] },
        })
      )
    );

    // Settle all except the last bet (leave one open to show the input UI)
    if (!isLast) {
      const winnerIdx = Math.floor(Math.random() * users.length);
      await db.sideBet.update({
        where: { id: sideBet.id },
        data: { winnerEntryId: entries[winnerIdx].id },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export async function buildReport(roomId: string): Promise<TestTournamentReport> {
  const room = await db.room.findUniqueOrThrow({ where: { id: roomId } });

  const members = await db.roomMember.findMany({
    where: { roomId },
    include: { user: { select: { id: true, name: true } } },
  });

  const memberIds = members.map((m) => m.userId);
  // Test users store preds with roomId; real members store group match preds with roomId: null
  const predictions = await db.prediction.findMany({
    where: {
      userId: { in: memberIds },
      OR: [{ roomId }, { roomId: null }],
    },
  });
  const groupPreds = await db.groupStandingPrediction.findMany({ where: { roomId } });

  const byUser = new Map<string, LeaderboardEntry>();
  for (const m of members) {
    byUser.set(m.userId, { name: m.user.name ?? m.userId, points: 0, earned: 0 });
  }

  for (const pred of predictions) {
    const entry = byUser.get(pred.userId);
    if (!entry) continue;
    entry.points += pred.points ?? 0;
    entry.earned += pred.earnedAmount ?? 0;
  }
  for (const pred of groupPreds) {
    const entry = byUser.get(pred.userId);
    if (!entry) continue;
    entry.earned += pred.earnedAmount ?? 0;
  }

  const leaderboard = [...byUser.values()].sort((a, b) => b.earned - a.earned || b.points - a.points);
  const potTotal = room.entryFee * members.length;

  return { roomId, roomName: room.name, leaderboard, potTotal };
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export async function cleanupTestInRoom(roomId: string): Promise<void> {
  const testEmails = TEST_USERS.map((u) => u.email);
  const testUsers = await db.user.findMany({ where: { email: { in: testEmails } }, select: { id: true } });
  if (testUsers.length === 0) return;
  const ids = testUsers.map((u) => u.id);

  // Reset ALL match scores that were set during the test
  await db.match.updateMany({ where: { status: "finished" }, data: { homeScore: null, awayScore: null, status: "scheduled" } });

  await db.sideBetEntry.deleteMany({ where: { sideBet: { roomId }, userId: { in: ids } } });
  await db.sideBet.deleteMany({ where: { roomId, proposedByUserId: { in: ids } } });
  await db.p2PSideBet.deleteMany({ where: { roomId, proposerId: { in: ids } } });
  await db.p2PSideBet.deleteMany({ where: { roomId, acceptorId: { in: ids } } });
  await db.prediction.deleteMany({ where: { roomId, userId: { in: ids } } });
  await db.groupStandingPrediction.deleteMany({ where: { roomId, userId: { in: ids } } });
  await db.roomMember.deleteMany({ where: { roomId, userId: { in: ids } } });

  // Reset scores on real member predictions that were scored against test match results
  await db.prediction.updateMany({ where: { roomId }, data: { points: null, earnedAmount: null } });
  await db.groupStandingPrediction.updateMany({ where: { roomId }, data: { earnedAmount: null } });

  for (const id of ids) {
    const remaining = await db.roomMember.count({ where: { userId: id } });
    if (remaining === 0) await db.user.delete({ where: { id } });
  }
}

export async function cleanupTestTournament(): Promise<void> {
  const room = await db.room.findUnique({ where: { inviteCode: TEST_ROOM_INVITE } });

  if (room) {
    await db.match.updateMany({ where: { status: "finished" }, data: { homeScore: null, awayScore: null, status: "scheduled" } });
    await db.sideBetEntry.deleteMany({ where: { sideBet: { roomId: room.id } } });
    await db.sideBet.deleteMany({ where: { roomId: room.id } });
    await db.p2PSideBet.deleteMany({ where: { roomId: room.id } });
    await db.groupStandingPrediction.deleteMany({ where: { roomId: room.id } });
    await db.prediction.deleteMany({ where: { roomId: room.id } });
    await db.roomMember.deleteMany({ where: { roomId: room.id } });
    await db.room.delete({ where: { id: room.id } });
  }

  const testUsers = await db.user.findMany({ where: { email: { startsWith: TEST_PREFIX } }, select: { id: true } });
  if (testUsers.length > 0) await db.user.deleteMany({ where: { id: { in: testUsers.map((u) => u.id) } } });
}
