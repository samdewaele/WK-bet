"use client";

import { useEffect, useState } from "react";

type Team = { id: string; name: string; flag: string };

type StandingRow = {
  wcGroup: string;
  positions: Team[];
  earnedAmount: number | null;
};

type KORow = {
  matchId: string;
  round: string;
  matchNumber: number;
  homeScore: number;
  awayScore: number;
  earnedAmount: number | null;
  match: {
    kickoff: string;
    status: string;
    homeTeam: Team | null;
    awayTeam: Team | null;
    homeScore: number | null;
    awayScore: number | null;
  };
};

type MemberOverview = {
  userId: string;
  name: string | null;
  image: string | null;
  standings: StandingRow[];
  knockout: KORow[] | null;
};

type Overview = { revealKO: boolean; members: MemberOverview[] };

const WC_GROUPS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];
const POS_LABELS = ["1st", "2nd", "3rd", "4th"];
const ROUND_LABELS: Record<string, string> = {
  R32: "Round of 32", R16: "Round of 16", QF: "Quarter-finals",
  SF: "Semi-finals", "3rd": "Third place", Final: "Final",
};

export default function SharedPredictions({ roomId }: { roomId: string }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"groups" | "ko">("groups");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/groups/${roomId}/predictions-overview`)
      .then(async (r) => {
        if (!active) return;
        if (r.ok) setData(await r.json());
        else setError((await r.json()).error ?? "Failed to load");
      })
      .catch(() => active && setError("Failed to load"))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [roomId]);

  if (loading) return <p className="text-sm text-gray-500">Loading predictions…</p>;
  if (error) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center">
        <p className="text-sm text-gray-400">🔒 {error}</p>
      </div>
    );
  }
  if (!data || data.members.length === 0) {
    return <p className="text-sm text-gray-500">No predictions to show yet.</p>;
  }

  const teamCell = (t: Team) => (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span>{t.flag}</span>
      <span className="text-gray-200">{t.name}</span>
    </span>
  );

  return (
    <div className="space-y-6">
      {data.revealKO && (
        <div className="flex gap-2">
          <button
            onClick={() => setView("groups")}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              view === "groups" ? "bg-amber-400 text-gray-900" : "bg-gray-800 text-gray-300 hover:bg-gray-700"
            }`}
          >
            Group standings
          </button>
          <button
            onClick={() => setView("ko")}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              view === "ko" ? "bg-amber-400 text-gray-900" : "bg-gray-800 text-gray-300 hover:bg-gray-700"
            }`}
          >
            Knockout picks
          </button>
        </div>
      )}

      {/* Group standings: one card per WC group, members × positions */}
      {view === "groups" && (
        <div className="grid gap-4 md:grid-cols-2">
          {WC_GROUPS.map((g) => {
            const rows = data.members
              .map((m) => ({ m, s: m.standings.find((s) => s.wcGroup === g) }))
              .filter((r) => r.s);
            if (rows.length === 0) return null;
            return (
              <div key={g} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <h3 className="text-sm font-bold text-amber-400 mb-3">Group {g}</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-500">
                        <th className="text-left px-2 py-1 font-medium">Player</th>
                        {POS_LABELS.map((p) => (
                          <th key={p} className="text-left px-2 py-1 font-medium">{p}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(({ m, s }) => (
                        <tr key={m.userId} className="border-t border-gray-800">
                          <td className="px-2 py-1.5 text-white font-medium whitespace-nowrap">{m.name ?? "Player"}</td>
                          {s!.positions.map((t, i) => (
                            <td key={i} className="px-2 py-1.5">{teamCell(t)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* KO picks: per-member, expandable */}
      {view === "ko" && data.revealKO && (
        <div className="space-y-2">
          {data.members.map((m) => {
            const ko = m.knockout ?? [];
            const isOpen = expanded === m.userId;
            return (
              <div key={m.userId} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <button
                  onClick={() => setExpanded(isOpen ? null : m.userId)}
                  className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-800/50 transition-colors"
                >
                  <span className="text-white font-medium">{m.name ?? "Player"}</span>
                  <span className="text-xs text-gray-500">{ko.length} pick{ko.length !== 1 ? "s" : ""} {isOpen ? "▲" : "▼"}</span>
                </button>
                {isOpen && (
                  <div className="px-4 pb-3">
                    {ko.length === 0 ? (
                      <p className="text-xs text-gray-500">No knockout predictions submitted.</p>
                    ) : (
                      <table className="w-full text-xs">
                        <tbody>
                          {ko.map((p) => (
                            <tr key={p.matchId} className="border-t border-gray-800">
                              <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap">{ROUND_LABELS[p.round] ?? p.round}</td>
                              <td className="px-2 py-1.5 text-right text-gray-200">{p.match.homeTeam?.flag} {p.match.homeTeam?.name ?? "TBD"}</td>
                              <td className="px-2 py-1.5 text-center font-bold text-white whitespace-nowrap">{p.homeScore}–{p.awayScore}</td>
                              <td className="px-2 py-1.5 text-left text-gray-200">{p.match.awayTeam?.name ?? "TBD"} {p.match.awayTeam?.flag}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
