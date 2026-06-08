import { db } from "@/lib/db";

export async function isTournamentStarted(): Promise<boolean> {
  const first = await db.match.findFirst({
    where: { round: "Group" },
    orderBy: { kickoff: "asc" },
    select: { kickoff: true },
  });
  return first ? new Date() >= first.kickoff : false;
}

/** Returns a map of WC group letter → ISO string of that group's first match kickoff. */
export async function getGroupKickoffTimes(): Promise<Record<string, string>> {
  const matches = await db.match.findMany({
    where: { round: "Group", group: { not: null } },
    select: { group: true, kickoff: true },
    orderBy: { kickoff: "asc" },
  });
  const result: Record<string, string> = {};
  for (const m of matches) {
    if (m.group && !result[m.group]) {
      result[m.group] = m.kickoff.toISOString();
    }
  }
  return result;
}
