import { db } from "@/lib/db";

export async function isTournamentStarted(): Promise<boolean> {
  const first = await db.match.findFirst({
    where: { round: "Group" },
    orderBy: { kickoff: "asc" },
    select: { kickoff: true },
  });
  return first ? new Date() >= first.kickoff : false;
}
