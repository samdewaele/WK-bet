"use client";

import { useState, useEffect } from "react";
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

type Props = {
  roomId: string;
  currentUserId: string;
  totalPot: number;
};

export default function GroupLeaderboard({ roomId, currentUserId, totalPot }: Props) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`/api/groups/${roomId}/leaderboard`);
        if (res.ok) {
          setEntries(await res.json());
        }
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [roomId]);

  const distributed = entries.reduce((sum, e) => sum + e.totalEarned, 0);
  const uberPot = Math.max(0, totalPot - distributed);

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl h-16 animate-pulse" />
        ))}
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
              return (
                <tr
                  key={entry.userId}
                  className={`${
                    entry.excludedFromPot
                      ? "opacity-50"
                      : isCurrentUser
                      ? "bg-amber-400/5 border border-amber-400/20 rounded-xl"
                      : ""
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
