"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { TestTournamentReport } from "@/lib/test-tournament";

type State =
  | { phase: "loading" }
  | { phase: "idle" }
  | { phase: "running" }
  | { phase: "done"; report: TestTournamentReport }
  | { phase: "cleaning" };

export default function TestTournamentPanel() {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/admin/test-tournament")
      .then((r) => r.json())
      .then((data) => {
        if (data.exists) setState({ phase: "done", report: data.report });
        else setState({ phase: "idle" });
      })
      .catch(() => setState({ phase: "idle" }));
  }, []);

  async function handleRun() {
    setError("");
    setState({ phase: "running" });
    try {
      const res = await fetch("/api/admin/test-tournament", { method: "POST" });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed"); setState({ phase: "idle" }); return; }
      setState({ phase: "done", report: data.report });
    } catch {
      setError("Network error");
      setState({ phase: "idle" });
    }
  }

  async function handleCleanup() {
    setError("");
    setState({ phase: "cleaning" });
    try {
      await fetch("/api/admin/test-tournament", { method: "DELETE" });
      setState({ phase: "idle" });
    } catch {
      setError("Cleanup failed");
      setState({ phase: "idle" });
    }
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-white">Test Tournament</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Seeds 5 fake players with varying prediction quality, simulates 3 Group A matches, leaves data in DB so you can browse the real UI.
          </p>
        </div>

        <div className="flex gap-2 shrink-0">
          {(state.phase === "idle" || state.phase === "loading") && (
            <button
              onClick={handleRun}
              disabled={state.phase === "loading"}
              className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-colors"
            >
              {state.phase === "loading" ? "Checking…" : "▶ Seed & Simulate"}
            </button>
          )}

          {state.phase === "running" && (
            <button disabled className="inline-flex items-center gap-2 bg-violet-600 opacity-50 text-white font-semibold px-4 py-2 rounded-lg text-sm">
              <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Running…
            </button>
          )}

          {state.phase === "done" && (
            <>
              <Link
                href={`/groups/${state.report.roomId}`}
                className="inline-flex items-center gap-1 bg-amber-500 hover:bg-amber-400 text-gray-900 font-semibold px-4 py-2 rounded-lg text-sm transition-colors"
              >
                Open test room →
              </Link>
              <button
                onClick={handleCleanup}
                className="inline-flex items-center gap-1 bg-red-800 hover:bg-red-700 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-colors"
              >
                🗑 Cleanup
              </button>
            </>
          )}

          {state.phase === "cleaning" && (
            <button disabled className="inline-flex items-center gap-2 bg-red-800 opacity-50 text-white font-semibold px-4 py-2 rounded-lg text-sm">
              <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Cleaning…
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-400 mb-3">{error}</p>}

      {state.phase === "done" && (
        <div className="mt-4 space-y-4">
          {/* Match results */}
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Simulated Results</h3>
            <div className="flex flex-wrap gap-3">
              {state.report.matches.map((m, i) => (
                <div key={i} className="bg-gray-800 rounded-lg px-4 py-2 text-sm text-center">
                  <span className="text-gray-300">{m.homeTeam}</span>
                  <span className="text-amber-400 font-bold mx-2">{m.score}</span>
                  <span className="text-gray-300">{m.awayTeam}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Leaderboard */}
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              Leaderboard — pot: €{state.report.potTotal.toFixed(2)}
            </h3>
            <div className="overflow-x-auto rounded-lg border border-gray-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 text-xs uppercase border-b border-gray-700">
                    <th className="text-left px-3 py-2">#</th>
                    <th className="text-left px-3 py-2">Player</th>
                    <th className="text-right px-3 py-2">Points</th>
                    <th className="text-right px-3 py-2">Est. share</th>
                    <th className="text-left px-3 py-2 hidden sm:table-cell">Breakdown</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const totalPts = state.report.leaderboard.reduce((s, p) => s + p.points, 0);
                    return state.report.leaderboard.map((player, i) => {
                      const share = totalPts > 0 ? (player.points / totalPts) * state.report.potTotal : 0;
                      return (
                        <tr key={i} className="border-b border-gray-800 last:border-0 hover:bg-gray-800/50">
                          <td className="px-3 py-2 text-gray-500 font-mono">{i + 1}</td>
                          <td className="px-3 py-2 text-white font-medium">{player.name}</td>
                          <td className="px-3 py-2 text-right text-amber-400 font-bold">{player.points}</td>
                          <td className="px-3 py-2 text-right text-green-400">€{share.toFixed(2)}</td>
                          <td className="px-3 py-2 text-gray-400 text-xs hidden sm:table-cell">
                            {player.breakdown.map((b, j) => (
                              <span key={j} className="mr-3 whitespace-nowrap">
                                {b.matchLabel.split(" vs ")[0]} pred {b.predicted} actual {b.actual}{" "}
                                <span className={b.pts > 0 ? "text-green-400" : "text-gray-600"}>
                                  +{b.pts}
                                </span>
                              </span>
                            ))}
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-xs text-gray-500">
            You are added as a member of the test room. Navigate to it, switch tabs, check the leaderboard — all real data.
            When done, click Cleanup to remove all test data and reset match statuses.
          </p>
        </div>
      )}
    </div>
  );
}
