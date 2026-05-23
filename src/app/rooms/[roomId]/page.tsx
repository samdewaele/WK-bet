import { notFound, redirect } from "next/navigation";
import { auth } from "@auth";
import { db } from "@/lib/db";
import Navbar from "@/components/Navbar";
import Image from "next/image";
import { ROUND_LABELS, ROUND_ORDER, type Round } from "@/lib/points";
import Link from "next/link";

export default async function RoomLeaderboardPage({
  params,
}: {
  params: { roomId: string };
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth/signin");
  }

  const { roomId } = params;
  const currentUserId = session.user.id;

  // Verify the user is a member of this room
  const membership = await db.roomMember.findUnique({
    where: { userId_roomId: { userId: currentUserId, roomId } },
  });
  if (!membership) notFound();

  const room = await db.room.findUnique({
    where: { id: roomId },
    include: {
      members: {
        include: {
          user: {
            include: {
              predictions: {
                include: {
                  match: { select: { round: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!room) notFound();

  const rows = room.members
    .map(({ user }) => {
      const scored = user.predictions.filter((p) => p.points !== null);
      const totalPoints = scored.reduce((sum, p) => sum + (p.points ?? 0), 0);
      const correctPredictions = scored.filter((p) => (p.points ?? 0) > 0).length;

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
    .sort(
      (a, b) =>
        b.totalPoints - a.totalPoints ||
        b.correctPredictions - a.correctPredictions
    );

  return (
    <div className="min-h-screen bg-[#0a0f1e] text-white">
      <Navbar />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {/* Header */}
        <div className="mb-8 flex items-center gap-4">
          <Link
            href="/rooms"
            className="text-gray-400 hover:text-white transition-colors text-sm"
          >
            ← Rooms
          </Link>
          <div>
            <h1 className="text-3xl font-bold text-white">{room.name}</h1>
            <p className="text-gray-400 text-sm mt-0.5">
              {room.members.length} member{room.members.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>

        {/* Invite code banner */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl px-5 py-3 mb-8 flex items-center justify-between gap-4">
          <div className="text-sm text-gray-400">
            Invite code:{" "}
            <code className="text-amber-400 font-mono">{room.inviteCode}</code>
          </div>
        </div>

        {/* Leaderboard */}
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
                      className={`border-b border-gray-800 ${
                        isCurrentUser
                          ? "bg-amber-400/10"
                          : "hover:bg-gray-800/40"
                      }`}
                    >
                      <td className="py-4 px-4">
                        {medal ?? (
                          <span className="text-gray-500 font-bold text-sm">{rank}</span>
                        )}
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-3">
                          {row.image ? (
                            <Image
                              src={row.image}
                              alt={row.name}
                              width={32}
                              height={32}
                              className="rounded-full border-2 border-gray-700"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-amber-400/20 flex items-center justify-center text-amber-400 font-bold text-sm">
                              {row.name[0]?.toUpperCase() ?? "?"}
                            </div>
                          )}
                          <span className="font-semibold text-white text-sm">
                            {row.name}
                            {isCurrentUser && (
                              <span className="ml-2 text-xs text-amber-400">(you)</span>
                            )}
                          </span>
                        </div>
                      </td>
                      <td className="py-4 px-4 text-center">
                        <span className="text-xl font-extrabold text-amber-400">
                          {row.totalPoints}
                        </span>
                      </td>
                      <td className="py-4 px-4 text-center hidden sm:table-cell">
                        <span className="text-green-400 font-semibold">
                          {row.correctPredictions}
                        </span>
                      </td>
                    </tr>
                    <tr
                      key={`${row.id}-detail`}
                      className={`border-b border-gray-800/50 ${isCurrentUser ? "bg-amber-400/5" : ""}`}
                    >
                      <td colSpan={4} className="px-4 pb-3 pt-0">
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
                                <span className="text-amber-400 font-bold">{row.byRound[r]}</span>
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
      </div>
    </div>
  );
}
