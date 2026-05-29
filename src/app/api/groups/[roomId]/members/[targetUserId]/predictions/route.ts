import { NextResponse } from "next/server";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { isTournamentStarted } from "@/lib/tournament-lock";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ roomId: string; targetUserId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { roomId, targetUserId } = await params;

  const [membership, targetMembership, started] = await Promise.all([
    db.roomMember.findUnique({ where: { userId_roomId: { userId: session.user.id, roomId } } }),
    db.roomMember.findUnique({ where: { userId_roomId: { userId: targetUserId, roomId } } }),
    isTournamentStarted(),
  ]);

  if (!membership) return NextResponse.json({ error: "Not a member" }, { status: 403 });
  if (!targetMembership) return NextResponse.json({ error: "User not a member" }, { status: 404 });
  if (!started) return NextResponse.json({ error: "Predictions are revealed after tournament starts" }, { status: 403 });

  const [groupStandings, koPredictions, teams] = await Promise.all([
    db.groupStandingPrediction.findMany({
      where: { roomId, userId: targetUserId },
      orderBy: { wcGroup: "asc" },
    }),
    db.prediction.findMany({
      where: { roomId, userId: targetUserId },
      include: {
        match: {
          include: {
            homeTeam: { select: { id: true, name: true, flag: true } },
            awayTeam: { select: { id: true, name: true, flag: true } },
          },
        },
      },
      orderBy: { match: { kickoff: "asc" } },
    }),
    db.team.findMany({ select: { id: true, name: true, flag: true } }),
  ]);

  const teamMap = new Map(teams.map((t) => [t.id, t]));

  return NextResponse.json({
    groupStandings: groupStandings.map((g) => ({
      wcGroup: g.wcGroup,
      positions: [g.position1, g.position2, g.position3, g.position4].map(
        (id) => teamMap.get(id) ?? { id, name: "?", flag: "" }
      ),
      earnedAmount: g.earnedAmount,
    })),
    knockoutPredictions: koPredictions.map((p) => ({
      matchId: p.matchId,
      homeScore: p.homeScore,
      awayScore: p.awayScore,
      earnedAmount: p.earnedAmount,
      match: {
        round: p.match.round,
        matchNumber: p.match.matchNumber,
        kickoff: p.match.kickoff.toISOString(),
        homeTeam: p.match.homeTeam,
        awayTeam: p.match.awayTeam,
        homeScore: p.match.homeScore,
        awayScore: p.match.awayScore,
        status: p.match.status,
      },
    })),
  });
}
