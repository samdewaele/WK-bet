"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";

type LeaderboardEntry = {
  rank: number;
  userId: string;
  name: string | null;
  image: string | null;
  groupStage: number;
  knockout: number;
  sideBets: number;
  totalEarned: number;
  excludedFromPot: boolean;
};

type BreakdownGroup = { wcGroup: string; earnedAmount: number };
type BreakdownMatch = {
  round: string;
  matchNumber: number;
  homeTeam: string;
  awayTeam: string;
  predicted: string;
  earnedAmount: number;
};
type BreakdownBet = { betTitle: string; earnedAmount: number };
type Breakdown = {
  groupStage: { total: number; groups: BreakdownGroup[] };
  knockout: { total: number; matches: BreakdownMatch[] };
  sideBets: { total: number; bets: BreakdownBet[] };
  total: number;
} | null;

type Props = {
  roomId: string;
  currentUserId: string;
  totalPot: number;
  roomStatus: string;
};

export default function GroupLeaderboard({ roomId, currentUserId, totalPot, roomStatus }: Props) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [breakdowns, setBreakdowns] = useState<Record<string, Breakdown>>({});
  const [loadingBreakdown, setLoadingBreakdown] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setBreakdowns({});
    setExpandedUserId(null);
    try {
      const res = await fetch(`/api/groups/${roomId}/leaderboard`, { cache: "no-store" });
      if (res.ok) setEntries(await res.json());
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  // Re-fetch whenever room status changes (e.g. after simulation cleanup)
  useEffect(() => {
    fetchData();
  }, [fetchData, roomStatus]);

  async function handleRowClick(userId: string) {
    if (expandedUserId === userId) {
      setExpandedUserId(null);
      return;
    }
    setExpandedUserId(userId);
    if (breakdowns[userId] !== undefined) return;
    setLoadingBreakdown(userId);
    try {
      const res = await fetch(`/api/groups/${roomId}/leaderboard/${userId}`);
      if (res.ok) {
        const data = await res.json();
        setBreakdowns((prev) => ({ ...prev, [userId]: data }));
      } else {
        setBreakdowns((prev) => ({ ...prev, [userId]: null }));
      }
    } finally {
      setLoadingBreakdown(null);
    }
  }

  const distributed = entries.reduce((sum, e) => sum + e.totalEarned, 0);
  const uberPot = Math.max(0, totalPot - distributed);

  const hasAnyEarnings = entries.some((e) => e.totalEarned > 0);

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl h-16 animate-pulse" />
        ))}
      </div>
    );
  }

  if (!hasAnyEarnings) {
    const message =
      roomStatus === "group_active"
        ? "Group stage in progress — standings will update as matches are scored."
        : roomStatus === "ko_betting"
        ? "Group stage complete — standings will show once match results are processed."
        : "No results yet — standings appear once matches have been played and scored.";
    return (
      <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-10 text-center">
        <div className="text-3xl mb-3">📊</div>
        <p className="text-white font-semibold text-lg mb-1">No standings yet</p>
        <p className="text-gray-500 text-sm">{message}</p>
        <button
          onClick={fetchData}
          className="mt-4 text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          ↻ Refresh
        </button>
      </div>
    );
  }

  return (
    <div>
      {uberPot > 0 && (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 mb-6 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-blue-300">Uber Pot</div>
            <div className="text-xs text-gray-400 mt-0.5">Unclaimed funds awaiting side bets</div>
          </div>
          <div className="text-2xl font-bold text-blue-300">€{uberPot.toFixed(2)}</div>
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-gray-500">Click a player to see their earnings breakdown.</p>
        <button
          onClick={fetchData}
          disabled={loading}
          className="text-xs text-gray-500 hover:text-gray-300 disabled:opacity-40 transition-colors"
        >
          ↻ Refresh
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-400 border-b border-gray-800">
              <th className="text-left py-3 pr-4 w-8">#</th>
              <th className="text-left py-3 pr-4">Player</th>
              <th className="text-right py-3 pr-4">Group Stage</th>
              <th className="text-right py-3 pr-4">Knockout</th>
              <th className="text-right py-3 pr-4">Side Bets</th>
              <th className="text-right py-3">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/50">
            {entries.map((entry) => {
              const isCurrentUser = entry.userId === currentUserId;
              const isExpanded = expandedUserId === entry.userId;
              const breakdown = breakdowns[entry.userId];
              const isLoadingThis = loadingBreakdown === entry.userId;

              return (
                <>
                  <tr
                    key={entry.userId}
                    onClick={() => handleRowClick(entry.userId)}
                    className={`cursor-pointer transition-colors ${
                      entry.excludedFromPot
                        ? "opacity-50"
                        : isExpanded
                        ? "bg-gray-800/60"
                        : isCurrentUser
                        ? "bg-amber-400/5 hover:bg-amber-400/10"
                        : "hover:bg-gray-800/40"
                    }`}
                  >
                    <td className="py-4 pr-4">
                      <span
                        className={`font-bold ${
                          entry.rank === 1
                            ? "text-yellow-400"
                            : entry.rank === 2
                            ? "text-gray-300"
                            : entry.rank === 3
                            ? "text-amber-600"
                            : "text-gray-500"
                        }`}
                      >
                        {entry.rank}
                      </span>
                    </td>
                    <td className="py-4 pr-4">
                      <div className="flex items-center gap-3">
                        {entry.image ? (
                          <Image
                            src={entry.image}
                            alt={entry.name ?? "User"}
                            width={32}
                            height={32}
                            className="rounded-full"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-amber-400 flex items-center justify-center text-gray-900 font-bold text-xs">
                            {entry.name?.[0]?.toUpperCase() ?? "?"}
                          </div>
                        )}
                        <span className={`font-medium ${isCurrentUser ? "text-amber-400" : "text-white"}`}>
                          {entry.name ?? "Unknown"}
                          {isCurrentUser && <span className="text-xs text-gray-500 ml-1">(you)</span>}
                          {entry.excludedFromPot && (
                            <span className="ml-1.5 text-xs text-red-400 font-normal bg-red-900/30 border border-red-800/50 rounded px-1">excluded</span>
                          )}
                        </span>
                      </div>
                    </td>
                    <td className="py-4 pr-4 text-right text-gray-300">
                      €{entry.groupStage.toFixed(2)}
                    </td>
                    <td className="py-4 pr-4 text-right text-gray-300">
                      €{entry.knockout.toFixed(2)}
                    </td>
                    <td className="py-4 pr-4 text-right text-gray-300">
                      €{entry.sideBets.toFixed(2)}
                    </td>
                    <td className="py-4 text-right font-bold text-amber-400">
                      €{entry.totalEarned.toFixed(2)}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${entry.userId}-breakdown`} className="bg-gray-800/30">
                      <td colSpan={6} className="px-4 pb-4 pt-2">
                        {isLoadingThis ? (
                          <div className="text-xs text-gray-500 py-2">Loading breakdown…</div>
                        ) : !breakdown ? (
                          <div className="text-xs text-gray-500 py-2">No earnings yet.</div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                            <div>
                              <div className="font-semibold text-amber-400 mb-2">
                                Group Stage — €{breakdown.groupStage.total.toFixed(2)}
                              </div>
                              {breakdown.groupStage.groups.length === 0 ? (
                                <p className="text-gray-600">No earnings</p>
                              ) : (
                                <div className="space-y-1">
                                  {breakdown.groupStage.groups
                                    .filter((g) => g.earnedAmount > 0)
                                    .map((g) => (
                                      <div key={g.wcGroup} className="flex justify-between text-gray-300">
                                        <span>Group {g.wcGroup}</span>
                                        <span className="text-green-400 font-medium">+€{g.earnedAmount.toFixed(2)}</span>
                                      </div>
                                    ))}
                                  {breakdown.groupStage.groups.every((g) => g.earnedAmount === 0) && (
                                    <p className="text-gray-600">No earnings</p>
                                  )}
                                </div>
                              )}
                            </div>
                            <div>
                              <div className="font-semibold text-amber-400 mb-2">
                                Knockout — €{breakdown.knockout.total.toFixed(2)}
                              </div>
                              {breakdown.knockout.matches.length === 0 ? (
                                <p className="text-gray-600">No earnings</p>
                              ) : (
                                <div className="space-y-1">
                                  {breakdown.knockout.matches.map((m, i) => (
                                    <div key={i} className="flex justify-between text-gray-300 gap-2">
                                      <span className="truncate">{m.homeTeam} vs {m.awayTeam} ({m.predicted})</span>
                                      <span className="text-green-400 font-medium shrink-0">+€{m.earnedAmount.toFixed(2)}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                            <div>
                              <div className="font-semibold text-amber-400 mb-2">
                                Side Bets — €{breakdown.sideBets.total.toFixed(2)}
                              </div>
                              {breakdown.sideBets.bets.length === 0 ? (
                                <p className="text-gray-600">No winnings</p>
                              ) : (
                                <div className="space-y-1">
                                  {breakdown.sideBets.bets.map((b, i) => (
                                    <div key={i} className="flex justify-between text-gray-300 gap-2">
                                      <span className="truncate">{b.betTitle}</span>
                                      <span className="text-green-400 font-medium shrink-0">+€{b.earnedAmount.toFixed(2)}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>

      {entries.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <p>No earnings yet. Predictions are still being evaluated.</p>
        </div>
      )}
    </div>
  );
}
