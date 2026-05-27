import { NextResponse } from "next/server";
import { auth } from "@auth";
import { db } from "@/lib/db";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const matches = await db.match.findMany({
    orderBy: [{ kickoff: "asc" }, { matchNumber: "asc" }],
    include: {
      homeTeam: { select: { id: true, name: true, flag: true, group: true } },
      awayTeam: { select: { id: true, name: true, flag: true, group: true } },
    },
  });

  return NextResponse.json(
    matches.map((m) => ({
      id: m.id,
      round: m.round,
      group: m.group,
      matchNumber: m.matchNumber,
      kickoff: m.kickoff.toISOString(),
      homeScore: m.homeScore,
      awayScore: m.awayScore,
      status: m.status,
      homeTeam: m.homeTeam,
      awayTeam: m.awayTeam,
    }))
  );
}
