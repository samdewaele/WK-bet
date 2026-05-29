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

  const koPreds = await db.prediction.findMany({
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

  const [groupAgg, koAgg] = await Promise.all([
    db.groupStandingPrediction.aggregate({ where: { roomId }, _sum: { earnedAmount: true } }),
    db.prediction.aggregate({ where: { roomId }, _sum: { earnedAmount: true } }),
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

  const groupStageTotal = groupPreds.reduce((s, p) => s + (p.earnedAmount ?? 0), 0);
  const knockoutTotal = koPreds.reduce((s, p) => s + (p.earnedAmount ?? 0), 0);
  const sideBetsTotal = sideBetWins.reduce((s, b) => s + b.earnedAmount, 0);

  return NextResponse.json({
    userId: targetUserId,
    groupStage: {
      total: groupStageTotal,
      groups: groupPreds.map((p) => ({ wcGroup: p.wcGroup, earnedAmount: p.earnedAmount ?? 0 })),
    },
    knockout: {
      total: knockoutTotal,
      matches: koPreds
        .filter((p) => (p.earnedAmount ?? 0) > 0)
        .map((p) => ({
          round: p.match.round,
          matchNumber: p.match.matchNumber,
          homeTeam: p.match.homeTeam?.name ?? "TBD",
          awayTeam: p.match.awayTeam?.name ?? "TBD",
          predicted: `${p.homeScore}–${p.awayScore}`,
          earnedAmount: p.earnedAmount ?? 0,
        })),
    },
    sideBets: {
      total: sideBetsTotal,
      bets: sideBetWins,
    },
    total: groupStageTotal + knockoutTotal + sideBetsTotal,
  });
}
