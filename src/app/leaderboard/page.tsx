import { auth } from "@auth";
import { db } from "@/lib/db";
import Navbar from "@/components/Navbar";
import { ROUND_LABELS, ROUND_ORDER, type Round } from "@/lib/points";
import Image from "next/image";

export const revalidate = 60;

export default async function LeaderboardPage() {
  const session = await auth();
  const currentUserId = session?.user?.id;

  // Fetch all users who have at least one prediction
  const usersWithPredictions = await db.user.findMany({
    include: {
      predictions: {
        include: {
          match: {
            select: { round: true },
          },
        },
      },
    },
  });

  // Build leaderboard rows
  const rows = usersWithPredictions
    .map((user) => {
      const scored = user.predictions.filter((p) => p.points !== null);
      const totalPoints = scored.reduce((sum, p) => sum + (p.points ?? 0), 0);
      const correctPredictions = scored.filter((p) => (p.points ?? 0) > 0).length;

      // Points by round
      const byRound: Record<string, number> = {};
      for (const p of scored) {
        const r = p.match.round;
        byRound[r] = (byRound[r] ?? 0) + (p.points ?? 0);
      }

      return {
        id: user.id,
        name: user.name ?? "Unknown",
        image: user.image,
        totalPoints,
        correctPredictions,
        totalPredictions: user.predictions.length,
        byRound,
      };
    })
    .filter((r) => r.totalPredictions > 0)
    .sort((a, b) => b.totalPoints - a.totalPoints || b.correctPredictions - a.correctPredictions);

  return (
    <div className="min-h-screen bg-[#0a0f1e] text-white">
      <Navbar />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">Leaderboard</h1>
          <p className="text-gray-400 mt-1">Global rankings across all players.</p>
        </div>

        {rows.length === 0 ? (
          <div className="text-center py-20 text-gray-500">
            <div className="text-5xl mb-4">📊</div>
            <p className="text-lg">No scores yet. Be the first to predict!</p>
          </div>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left py-4 px-4 text-gray-400 font-semibold text-sm w-12">#</th>
                  <th className="text-left py-4 px-4 text-gray-400 font-semibold text-sm">Player</th>
                  <th className="text-center py-4 px-4 text-gray-400 font-semibold text-sm">Points</th>
                  <th className="text-center py-4 px-4 text-gray-400 font-semibold text-sm hidden sm:table-cell">
                    Correct
                  </th>
                  <th className="text-center py-4 px-4 text-gray-400 font-semibold text-sm hidden md:table-cell">
                    Predictions
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const isCurrentUser = row.id === currentUserId;
                  const rank = i + 1;
                  const medal =
                    rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : null;

                  return (
                    <>
                      <tr
                        key={row.id}
                        className={`border-b border-gray-800 transition-colors ${
                          isCurrentUser
                            ? "bg-amber-400/10 border-amber-400/30"
                            : "hover:bg-gray-800/40"
                        }`}
                      >
                        <td className="py-4 px-4">
                          <span className="text-lg">
                            {medal ?? (
                              <span className="text-gray-500 font-bold text-sm">{rank}</span>
                            )}
                          </span>
                        </td>
                        <td className="py-4 px-4">
                          <div className="flex items-center gap-3">
                            {row.image ? (
                              <Image
                                src={row.image}
                                alt={row.name}
                                width={36}
                                height={36}
                                className="rounded-full border-2 border-gray-700"
                              />
                            ) : (
                              <div className="w-9 h-9 rounded-full bg-amber-400/20 flex items-center justify-center text-amber-400 font-bold text-sm border-2 border-gray-700">
                                {row.name[0]?.toUpperCase() ?? "?"}
                              </div>
                            )}
                            <div>
                              <div className="font-semibold text-white text-sm">
                                {row.name}
                                {isCurrentUser && (
                                  <span className="ml-2 text-xs text-amber-400">(you)</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-4 px-4 text-center">
                          <span className="text-xl font-extrabold text-amber-400">
                            {row.totalPoints}
                          </span>
                        </td>
                        <td className="py-4 px-4 text-center hidden sm:table-cell">
                          <span className="text-green-400 font-semibold">{row.correctPredictions}</span>
                        </td>
                        <td className="py-4 px-4 text-center hidden md:table-cell">
                          <span className="text-gray-400">{row.totalPredictions}</span>
                        </td>
                      </tr>

                      {/* Points breakdown row (collapsible via details) */}
                      <tr
                        key={`${row.id}-detail`}
                        className={`border-b border-gray-800/50 ${
                          isCurrentUser ? "bg-amber-400/5" : ""
                        }`}
                      >
                        <td colSpan={5} className="px-4 pb-3 pt-0">
                          <details className="group">
                            <summary className="text-xs text-gray-500 hover:text-gray-300 cursor-pointer list-none flex items-center gap-1 select-none w-fit">
                              <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
                              Round breakdown
                            </summary>
                            <div className="mt-2 flex flex-wrap gap-2 pl-4">
                              {ROUND_ORDER.filter((r) => (row.byRound[r] ?? 0) > 0).map((r) => (
                                <span
                                  key={r}
                                  className="text-xs bg-gray-800 border border-gray-700 px-2 py-1 rounded-full text-gray-300"
                                >
                                  {ROUND_LABELS[r as Round]}:{" "}
                                  <span className="text-amber-400 font-bold">
                                    {row.byRound[r]}
                                  </span>
                                </span>
                              ))}
                              {ROUND_ORDER.every((r) => !(row.byRound[r] ?? 0)) && (
                                <span className="text-xs text-gray-600 italic">No points yet</span>
                              )}
                            </div>
                          </details>
                        </td>
                      </tr>
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
