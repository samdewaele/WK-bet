import { redirect } from "next/navigation";
import { auth } from "@auth";
import { db } from "@/lib/db";
import Navbar from "@/components/Navbar";
import AdminMatchList from "@/components/AdminMatchList";
import SyncButton from "@/components/SyncButton";
import TestTournamentPanel from "@/components/TestTournamentPanel";

export default async function AdminPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/auth/signin");
  }

  if (session.user.role !== "admin") {
    redirect("/");
  }

  const matches = await db.match.findMany({
    include: {
      homeTeam: true,
      awayTeam: true,
    },
    orderBy: [{ kickoff: "asc" }, { matchNumber: "asc" }],
  });

  const serialized = matches.map((m) => ({
    id: m.id,
    matchNumber: m.matchNumber,
    round: m.round,
    group: m.group,
    kickoff: m.kickoff.toISOString(),
    homeScore: m.homeScore,
    awayScore: m.awayScore,
    status: m.status,
    homeTeam: m.homeTeam
      ? { id: m.homeTeam.id, name: m.homeTeam.name, flag: m.homeTeam.flag }
      : null,
    awayTeam: m.awayTeam
      ? { id: m.awayTeam.id, name: m.awayTeam.name, flag: m.awayTeam.flag }
      : null,
  }));

  return (
    <div className="min-h-screen bg-[#0a0f1e] text-white">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="mb-8 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-white">Admin — Match Scores</h1>
            <span className="text-xs bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-1 rounded-full font-semibold">
              Admin only
            </span>
          </div>
          <SyncButton />
        </div>
        <div className="mb-10">
          <TestTournamentPanel />
        </div>
        <AdminMatchList matches={serialized} />
      </div>
    </div>
  );
}
