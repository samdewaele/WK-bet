import { redirect } from "next/navigation";
import { auth } from "@auth";
import { db } from "@/lib/db";
import Navbar from "@/components/Navbar";
import PredictionsClient from "@/components/PredictionsClient";

export default async function PredictPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/auth/signin");
  }

  const userId = session.user.id;

  // Fetch all matches with teams, ordered by round then kickoff
  const matches = await db.match.findMany({
    include: {
      homeTeam: true,
      awayTeam: true,
    },
    orderBy: [
      { kickoff: "asc" },
      { matchNumber: "asc" },
    ],
  });

  // Fetch user's existing predictions
  const predictions = await db.prediction.findMany({
    where: { userId },
  });

  // Serialize dates to strings for the client component
  const serializedMatches = matches.map((m) => ({
    ...m,
    kickoff: m.kickoff.toISOString(),
  }));

  const serializedPredictions = predictions.map((p) => ({
    ...p,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  }));

  return (
    <div className="min-h-screen bg-[#0a0f1e] text-white">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">My Predictions</h1>
          <p className="text-gray-400 mt-1">
            Submit your score predictions before each match kicks off.
          </p>
        </div>
        <PredictionsClient matches={serializedMatches} predictions={serializedPredictions} />
      </div>
    </div>
  );
}
