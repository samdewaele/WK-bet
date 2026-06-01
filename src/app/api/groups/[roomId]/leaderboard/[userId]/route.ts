import { NextResponse } from "next/server";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { calculatePot, prizePerSideBet } from "@/lib/pot";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ roomId: string; userId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { roomId, userId: targetUserId } = await params;

  const membership = await db.roomMember.findUnique({
    where: { userId_roomId: { userId: session.user.id, roomId } },
  });
  if (!membership) return NextResponse.json({ error: "Not a member" }, { status: 403 });

  const room = await db.room.findUnique({
    where: { id: roomId },
    include: {
      members: { select: { userId: true, excludedFromPot: true } },
      sideBets: {
        include: { entries: { select: { id: true, userId: true } } },
      },
    },
  });
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  const targetMember = room.members.find((m) => m.userId === targetUserId);
  if (!targetMember) return NextResponse.json({ error: "User not a member" }, { status: 404 });

  const groupPreds = await db.groupStandingPrediction.findMany({
    where: { roomId, userId: targetUserId },
    select: { wcGroup: true, earnedAmount: true },
    orderBy: { wcGroup: "asc" },
  });

  const koPreds = await db.kOPrediction.findMany({
    where: { roomId, userId: targetUserId },
    include: {
      match: {
        include: {
          homeTeam: { select: { name: true, flag: true } },
          awayTeam: { select: { name: true, flag: true } },
        },
      },
    },
    orderBy: { match: { kickoff: "asc" } },
  });

  const activeMemberCount = room.members.filter((m) => !m.excludedFromPot).length;
  const pot = calculatePot(room.entryFee, activeMemberCount);

  // Exclude earnings from pot-excluded members to match the main leaderboard calculation.
  const excludedIds = room.members.filter((m) => m.excludedFromPot).map((m) => m.userId);
  const [groupAgg, koAgg] = await Promise.all([
    db.groupStandingPrediction.aggregate({
      where: { roomId, ...(excludedIds.length > 0 ? { userId: { notIn: excludedIds } } : {}) },
      _sum: { earnedAmount: true },
    }),
    db.kOPrediction.aggregate({
      where: { roomId, ...(excludedIds.length > 0 ? { userId: { notIn: excludedIds } } : {}) },
      _sum: { earnedAmount: true },
    }),
  ]);
  const totalGroupDistributed = groupAgg._sum.earnedAmount ?? 0;
  const totalKODistributed = koAgg._sum.earnedAmount ?? 0;
  const uberPot = Math.max(0, pot.totalPot - totalGroupDistributed - totalKODistributed);

  const settledSideBets = room.sideBets.filter((sb) => sb.status === "settled");
  const prizeEach = prizePerSideBet(uberPot, settledSideBets.length);

  const sideBetWins = settledSideBets
    .filter((sb) => {
      if (!sb.winnerEntryId) return false;
      return sb.entries.find((e) => e.id === sb.winnerEntryId)?.userId === targetUserId;
    })
    .map((sb) => ({ betTitle: sb.title, earnedAmount: prizeEach }));

  const toCents = (v: number) => Math.round(v * 100);
  const fromCents = (c: number) => c / 100;

  const groupStageCents = groupPreds.reduce((s, p) => s + toCents(p.earnedAmount ?? 0), 0);
  const knockoutCents   = koPreds.reduce((s, p) => s + toCents(p.earnedAmount ?? 0), 0);
  const sideBetsCents   = sideBetWins.reduce((s, b) => s + toCents(b.earnedAmount), 0);

  return NextResponse.json({
    userId: targetUserId,
    groupStage: {
      total: fromCents(groupStageCents),
      groups: groupPreds.map((p) => ({ wcGroup: p.wcGroup, earnedAmount: fromCents(toCents(p.earnedAmount ?? 0)) })),
    },
    knockout: {
      total: fromCents(knockoutCents),
      matches: koPreds
        .filter((p) => (p.earnedAmount ?? 0) > 0)
        .map((p) => ({
          round: p.match.round,
          matchNumber: p.match.matchNumber,
          homeTeam: p.match.homeTeam?.name ?? "TBD",
          awayTeam: p.match.awayTeam?.name ?? "TBD",
          predicted: `${p.homeScore}–${p.awayScore}`,
          earnedAmount: fromCents(toCents(p.earnedAmount ?? 0)),
        })),
    },
    sideBets: {
      total: fromCents(sideBetsCents),
      bets: sideBetWins.map((b) => ({ ...b, earnedAmount: fromCents(toCents(b.earnedAmount)) })),
    },
    total: fromCents(groupStageCents + knockoutCents + sideBetsCents),
  });
}
