import { NextResponse } from "next/server";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { computeUberPotResults } from "@/lib/uber-pot";

// Group standings become visible to everyone once the group stage starts.
const STANDINGS_VISIBLE = ["group_active", "ko_betting", "ko_active", "settling", "finished"];
// KO predictions stay hidden until the knockout bracket locks (first KO kickoff).
const KO_VISIBLE = ["ko_active", "settling", "finished"];

/**
 * GET /api/groups/[roomId]/predictions-overview
 *
 * Cross-member view of everyone's predictions + winnings:
 *   - group standings: revealed from group_active onwards (with earned money once scored)
 *   - KO predictions:  revealed from ko_active onwards (with earned money once scored)
 *   - Uber Pot bets:   everyone's answers, revealed once the tournament kicks off;
 *                      winner + money shown once the admin settles each bet.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { roomId } = await params;

  const [membership, room] = await Promise.all([
    db.roomMember.findUnique({ where: { userId_roomId: { userId: session.user.id, roomId } } }),
    db.room.findUnique({ where: { id: roomId }, select: { status: true } }),
  ]);
  if (!membership) return NextResponse.json({ error: "Not a member" }, { status: 403 });
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  if (!STANDINGS_VISIBLE.includes(room.status)) {
    return NextResponse.json({ error: "Predictions are revealed once the group stage starts" }, { status: 403 });
  }
  const revealKO = KO_VISIBLE.includes(room.status);

  const [members, groupStandings, koPredictions, teams, sideBets, uber] = await Promise.all([
    db.roomMember.findMany({
      where: { roomId },
      include: { user: { select: { id: true, name: true, image: true } } },
    }),
    db.groupStandingPrediction.findMany({ where: { roomId }, orderBy: { wcGroup: "asc" } }),
    revealKO
      ? db.kOPrediction.findMany({
          where: { roomId },
          include: {
            match: {
              select: {
                round: true,
                matchNumber: true,
                kickoff: true,
                status: true,
                homeScore: true,
                awayScore: true,
                homeTeam: { select: { id: true, name: true, flag: true } },
                awayTeam: { select: { id: true, name: true, flag: true } },
              },
            },
          },
          orderBy: { match: { kickoff: "asc" } },
        })
      : Promise.resolve([] as never[]),
    db.team.findMany({ select: { id: true, name: true, flag: true } }),
    db.sideBet.findMany({
      where: { roomId },
      include: {
        entries: { include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } },
      },
      orderBy: { createdAt: "asc" },
    }),
    computeUberPotResults(roomId),
  ]);

  const teamMap = new Map(teams.map((t) => [t.id, t]));
  const resolve = (id: string) => teamMap.get(id) ?? { id, name: "?", flag: "" };

  const standingsByUser = new Map<string, typeof groupStandings>();
  for (const g of groupStandings) {
    const list = standingsByUser.get(g.userId) ?? [];
    list.push(g);
    standingsByUser.set(g.userId, list);
  }

  const koByUser = new Map<string, typeof koPredictions>();
  for (const p of koPredictions) {
    const list = koByUser.get(p.userId) ?? [];
    list.push(p);
    koByUser.set(p.userId, list);
  }

  return NextResponse.json({
    revealKO,
    members: members.map((m) => ({
      userId: m.userId,
      name: m.user.name,
      image: m.user.image,
      standings: (standingsByUser.get(m.userId) ?? []).map((g) => ({
        wcGroup: g.wcGroup,
        positions: [g.position1, g.position2, g.position3, g.position4].map(resolve),
        earnedAmount: g.earnedAmount,
      })),
      knockout: revealKO
        ? (koByUser.get(m.userId) ?? []).map((p) => ({
            matchId: p.matchId,
            round: p.match.round,
            matchNumber: p.match.matchNumber,
            homeScore: p.homeScore,
            awayScore: p.awayScore,
            earnedAmount: p.earnedAmount,
            match: {
              kickoff: p.match.kickoff.toISOString(),
              status: p.match.status,
              homeTeam: p.match.homeTeam,
              awayTeam: p.match.awayTeam,
              homeScore: p.match.homeScore,
              awayScore: p.match.awayScore,
            },
          }))
        : null,
    })),
    // Uber Pot: every member's answer per bet; winner + money once settled.
    uberPot: {
      prizePerSettledBet: uber.prizePerSettledBet,
      bets: sideBets
        .filter((sb) => sb.status !== "proposed")
        .map((sb) => {
          const result = uber.byBet.get(sb.id);
          return {
            id: sb.id,
            title: sb.title,
            description: sb.description,
            status: sb.status,
            winnerEntryId: sb.winnerEntryId,
            winnerUserId: result?.winnerUserId ?? null,
            prize: sb.status === "settled" ? (result?.prize ?? 0) : null,
            entries: sb.entries.map((e) => ({
              entryId: e.id,
              userId: e.userId,
              userName: e.user.name,
              answer: e.answer,
            })),
          };
        }),
    },
  });
}
