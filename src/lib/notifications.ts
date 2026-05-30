import { db } from "@/lib/db";
import { emailGroupStageComplete, emailRoundComplete, emailIncompleteReminder } from "@/lib/email";

const ROUNDS_IN_ORDER = ["Group", "R32", "R16", "QF", "SF", "3rd", "Final"] as const;
type Round = (typeof ROUNDS_IN_ORDER)[number];
// Group match score predictions are bonus-only, so we don't remind about them.
// Only KO rounds are required/expected predictions.
const REMINDER_ROUNDS = ["R32", "R16", "QF", "SF", "3rd", "Final"] as const;

async function isRoundComplete(round: string): Promise<boolean> {
  const total = await db.match.count({ where: { round } });
  if (total === 0) return false;
  const finished = await db.match.count({ where: { round, status: "finished" } });
  return total === finished;
}

async function wasNotified(type: string): Promise<boolean> {
  const n = await db.notification.findUnique({ where: { type } });
  return n !== null;
}

type LeaderboardRow = { name: string; rank: number; earned: number };

async function buildRoomLeaderboard(roomId: string): Promise<LeaderboardRow[]> {
  const members = await db.roomMember.findMany({
    where: { roomId },
    include: { user: { select: { id: true, name: true } } },
  });

  const groupEarned = await db.groupStandingPrediction.groupBy({
    by: ["userId"],
    where: { roomId },
    _sum: { earnedAmount: true },
  });
  const koEarned = await db.prediction.groupBy({
    by: ["userId"],
    where: { roomId },
    _sum: { earnedAmount: true },
  });

  const earnedMap = new Map<string, number>();
  for (const row of groupEarned) earnedMap.set(row.userId, row._sum.earnedAmount ?? 0);
  for (const row of koEarned) earnedMap.set(row.userId, (earnedMap.get(row.userId) ?? 0) + (row._sum.earnedAmount ?? 0));

  const sorted = members
    .map((m) => ({ name: m.user.name ?? "Unknown", earned: earnedMap.get(m.userId) ?? 0 }))
    .sort((a, b) => b.earned - a.earned)
    .slice(0, 5)
    .map((r, i) => ({ ...r, rank: i + 1 }));

  return sorted;
}

async function sendRoundEmails(round: Round): Promise<number> {
  const rooms = await db.room.findMany({
    where: { status: { in: ["betting", "closed", "group_active", "ko_betting", "ko_active"] } },
    include: {
      members: { include: { user: { select: { id: true, name: true, email: true } } } },
    },
  });

  let sent = 0;
  for (const room of rooms) {
    const leaderboard = await buildRoomLeaderboard(room.id);
    for (const member of room.members) {
      const { email, name } = member.user;
      if (!email) continue;
      const displayName = name ?? "there";
      if (round === "Group") {
        emailGroupStageComplete(email, displayName, room.name, room.id, leaderboard).catch(() => {});
      } else {
        emailRoundComplete(email, displayName, round, room.name, room.id, leaderboard).catch(() => {});
      }
      sent++;
    }
  }
  return sent;
}

export async function checkAndSendRoundNotifications(): Promise<{ round: string; sent: number }[]> {
  const results: { round: string; sent: number }[] = [];

  for (const round of ROUNDS_IN_ORDER) {
    const key = `round_complete:${round}`;
    if (await wasNotified(key)) continue;
    if (!(await isRoundComplete(round))) continue;

    const sent = await sendRoundEmails(round);
    await db.notification.create({ data: { type: key } });
    results.push({ round, sent });
  }

  return results;
}

export async function resetNotification(round: string): Promise<void> {
  await db.notification.deleteMany({ where: { type: `round_complete:${round}` } });
}

// ---------------------------------------------------------------------------
// 24h incomplete-prediction reminders
// ---------------------------------------------------------------------------

function formatDeadline(date: Date): string {
  return date.toLocaleString("en-GB", {
    weekday: "short", day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels",
  });
}

async function countMissingPredictions(userId: string, roomId: string, round: string): Promise<number> {
  const totalMatches = await db.match.count({ where: { round } });
  // Group match predictions are stored globally (roomId: null via /api/predictions)
  // KO predictions are stored per-room (via /api/groups/[roomId]/knockout)
  const effectiveRoomId = round === "Group" ? null : roomId;
  const submitted = await db.prediction.count({
    where: { userId, roomId: effectiveRoomId, match: { round } },
  });
  return Math.max(0, totalMatches - submitted);
}

export async function checkAndSendIncompleteReminders(): Promise<{ round: string; sent: number }[]> {
  const results: { round: string; sent: number }[] = [];
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const rooms = await db.room.findMany({
    where: { status: { in: ["betting", "closed", "group_active", "ko_betting", "ko_active"] } },
    include: {
      members: {
        where: { excludedFromPot: false },
        include: { user: { select: { id: true, name: true, email: true } } },
      },
    },
  });

  for (const round of REMINDER_ROUNDS) {
    const key = `reminder:${round}`;
    if (await wasNotified(key)) continue;

    // Find the first upcoming match of this round
    const firstMatch = await db.match.findFirst({
      where: { round, kickoff: { gt: now } },
      orderBy: { kickoff: "asc" },
    });
    if (!firstMatch) continue;
    if (firstMatch.kickoff > in24h) continue;

    const deadline = formatDeadline(firstMatch.kickoff);
    let sent = 0;

    for (const room of rooms) {
      for (const member of room.members) {
        const { email, name } = member.user;
        if (!email) continue;
        const missing = await countMissingPredictions(member.userId, room.id, round);
        if (missing === 0) continue;
        emailIncompleteReminder(
          email, name ?? "there", round, room.name, room.id, deadline, missing
        ).catch(() => {});
        sent++;
      }
    }

    await db.notification.create({ data: { type: key } });
    results.push({ round, sent });
  }

  return results;
}
