"use client";

import { useEffect, useState } from "react";
import TeamFlag from "@/components/TeamFlag";
import { formatKickoff } from "@/lib/ko-bracket";
import { koScheduledKickoff } from "@/lib/ko-schedule";

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

type UberEntry = { entryId: string; userId: string; userName: string | null; answer: string };
type UberBet = {
  id: string;
  title: string;
  description: string | null;
  status: "open" | "settled";
  winnerEntryId: string | null;
  winnerUserId: string | null;
  prize: number | null;
  entries: UberEntry[];
};
type GroupVisibility = { revealed: boolean; kickoff: string | null };

type Overview = {
  revealKO: boolean;
  groupVisibility: Record<string, GroupVisibility>;
  groupUberPot?: Record<string, number>;
  koMatchUberPot?: Record<string, number>;
  members: MemberOverview[];
  uberPot: { total?: number; prizePerSettledBet: number; bets: UberBet[] };
};

const WC_GROUPS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];
const POS_LABELS = ["1st", "2nd", "3rd", "4th"];
const ROUND_ORDER = ["R32", "R16", "QF", "SF", "3rd", "Final"];
const ROUND_LABELS: Record<string, string> = {
  R32: "Round of 32", R16: "Round of 16", QF: "Quarter-finals",
  SF: "Semi-finals", "3rd": "Third place", Final: "Final",
};

const money = (n: number) => `€${n.toFixed(2)}`;

export default function SharedPredictions({ roomId }: { roomId: string }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"groups" | "ko" | "uber">("groups");

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

  const hasUber = data.uberPot.bets.length > 0;
  const memberName = (id: string) => data.members.find((m) => m.userId === id)?.name ?? "Player";

  const teamCell = (t: Team) => (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <TeamFlag flag={t.flag} name={t.name} size={18} />
      <span className="text-gray-200">{t.name}</span>
    </span>
  );

  const earnedBadge = (amount: number | null) => {
    if (amount == null) return null;
    const won = amount > 0;
    return (
      <span
        className={`inline-flex items-center text-xs font-bold px-2 py-0.5 rounded-full ${
          won ? "bg-amber-400/20 text-amber-300" : "bg-gray-700 text-gray-500"
        }`}
      >
        {won ? `+${money(amount)}` : money(0)}
      </span>
    );
  };

  // Pivot KO predictions into per-match rows: { matchId, match, picks: [{member, pred}] }
  const koMatches = (() => {
    const map = new Map<string, { matchId: string; match: KORow["match"]; round: string; matchNumber: number; picks: { userId: string; row: KORow }[] }>();
    for (const m of data.members) {
      for (const p of m.knockout ?? []) {
        let entry = map.get(p.matchId);
        if (!entry) {
          entry = { matchId: p.matchId, match: p.match, round: p.round, matchNumber: p.matchNumber, picks: [] };
          map.set(p.matchId, entry);
        }
        entry.picks.push({ userId: m.userId, row: p });
      }
    }
    return [...map.values()].sort(
      (a, b) =>
        ROUND_ORDER.indexOf(a.round) - ROUND_ORDER.indexOf(b.round) || a.matchNumber - b.matchNumber,
    );
  })();

  const tabBtn = (key: typeof view, label: string) => (
    <button
      onClick={() => setView(key)}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
        view === key ? "bg-amber-400 text-gray-900" : "bg-gray-800 text-gray-300 hover:bg-gray-700"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {tabBtn("groups", "Group standings")}
        {data.revealKO && tabBtn("ko", "Knockout picks")}
        {hasUber && tabBtn("uber", "Uber Pot")}
      </div>

      {/* Group standings: one card per WC group, members × positions + winnings */}
      {view === "groups" && (
        <div className="grid gap-4 md:grid-cols-2">
          {WC_GROUPS.map((g) => {
            const visibility = data.groupVisibility?.[g];

            if (!visibility?.revealed) {
              if (!visibility?.kickoff) return null;
              const kickoffDate = new Date(visibility.kickoff);
              const formatted = kickoffDate.toLocaleString(undefined, {
                weekday: "short", month: "short", day: "numeric",
                hour: "2-digit", minute: "2-digit",
              });
              return (
                <div key={g} className="bg-gray-900 border border-gray-700 rounded-xl p-4">
                  <h3 className="text-sm font-bold text-amber-400 mb-2">Group {g}</h3>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <span>🔒</span>
                    <span>Predictions revealed when the first match kicks off — {formatted}</span>
                  </div>
                </div>
              );
            }

            const rows = data.members
              .map((m) => ({ m, s: m.standings.find((s) => s.wcGroup === g) }))
              .filter((r): r is { m: MemberOverview; s: StandingRow } => !!r.s);
            if (rows.length === 0) return null;
            const scored = rows.some((r) => r.s.earnedAmount != null);
            return (
              <div key={g} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="flex items-center gap-3 mb-3">
                  <h3 className="text-sm font-bold text-amber-400">Group {g}</h3>
                  {(data.groupUberPot?.[g] ?? 0) > 0 && (
                    <span className="text-xs text-blue-400" title="Unclaimed prize — flows to Uber Pot">
                      →Uber Pot €{data.groupUberPot![g].toFixed(2)}
                    </span>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-500">
                        <th className="text-left px-2 py-1 font-medium">Player</th>
                        {POS_LABELS.map((p) => (
                          <th key={p} className="text-left px-2 py-1 font-medium">{p}</th>
                        ))}
                        {scored && <th className="text-right px-2 py-1 font-medium">Won</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(({ m, s }) => {
                        const won = (s.earnedAmount ?? 0) > 0;
                        return (
                          <tr key={m.userId} className={`border-t border-gray-800 ${won ? "bg-amber-400/5" : ""}`}>
                            <td className="px-2 py-1.5 text-white font-medium whitespace-nowrap">
                              {won && <span className="mr-1">🏆</span>}
                              {m.name ?? "Player"}
                            </td>
                            {s.positions.map((t, i) => (
                              <td key={i} className="px-2 py-1.5">{teamCell(t)}</td>
                            ))}
                            {scored && (
                              <td className="px-2 py-1.5 text-right">{earnedBadge(s.earnedAmount)}</td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* KO picks: one card per match, all members' picks + winnings */}
      {view === "ko" && data.revealKO && (
        <div className="space-y-3">
          {koMatches.length === 0 ? (
            <p className="text-sm text-gray-500">No knockout predictions submitted yet.</p>
          ) : (
            koMatches.map((km) => {
              const finished = km.match.status === "finished" && km.match.homeScore != null && km.match.awayScore != null;
              return (
                <div key={km.matchNumber} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-gray-500">{ROUND_LABELS[km.round] ?? km.round}</span>
                      {/* Date from the official static schedule (team-independent), same as the bracket. */}
                      <span className="text-gray-600 text-xs">{formatKickoff(koScheduledKickoff(km.matchNumber) ?? km.match.kickoff)}</span>
                      <span className="inline-flex items-center gap-1.5 text-gray-200">
                        {km.match.homeTeam && <TeamFlag flag={km.match.homeTeam.flag} name={km.match.homeTeam.name} size={18} />}
                        {km.match.homeTeam?.name ?? "TBD"}
                      </span>
                      <span className="text-gray-500">v</span>
                      <span className="inline-flex items-center gap-1.5 text-gray-200">
                        {km.match.awayTeam && <TeamFlag flag={km.match.awayTeam.flag} name={km.match.awayTeam.name} size={18} />}
                        {km.match.awayTeam?.name ?? "TBD"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {finished && (
                        <span className="text-xs font-bold bg-gray-800 text-white px-2 py-1 rounded">
                          {km.match.homeScore}–{km.match.awayScore} FT
                        </span>
                      )}
                      {finished && (data.koMatchUberPot?.[km.matchId] ?? 0) > 0 && (
                        <span className="text-xs text-blue-400" title="Unclaimed prize — flows to Uber Pot">
                          →Uber Pot €{data.koMatchUberPot![km.matchId].toFixed(2)}
                        </span>
                      )}
                    </div>
                  </div>
                  <table className="w-full text-xs">
                    <tbody>
                      {km.picks.map(({ userId, row }) => {
                        const won = (row.earnedAmount ?? 0) > 0;
                        return (
                          <tr key={userId} className={`border-t border-gray-800 ${won ? "bg-amber-400/5" : ""}`}>
                            <td className="px-2 py-1.5 text-white font-medium whitespace-nowrap">
                              {won && <span className="mr-1">🏆</span>}
                              {memberName(userId)}
                            </td>
                            <td className="px-2 py-1.5 text-center font-bold text-white whitespace-nowrap">
                              {row.homeScore}–{row.awayScore}
                            </td>
                            <td className="px-2 py-1.5 text-right">{earnedBadge(row.earnedAmount)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Uber Pot: all members' answers per bet; winner + money once settled */}
      {view === "uber" && hasUber && (
        <div className="space-y-3">
          {(data.uberPot.total ?? 0) > 0 && (
            <div className="flex items-center gap-3 bg-amber-400/10 border border-amber-400/20 rounded-xl px-4 py-3">
              <span className="text-amber-400 text-lg">🏆</span>
              <div>
                <p className="text-sm font-semibold text-amber-300">Uber Pot: {money(data.uberPot.total!)}</p>
                <p className="text-xs text-gray-400">Accumulated from unclaimed group and match prizes</p>
              </div>
            </div>
          )}
          {data.uberPot.bets.map((bet) => {
            const settled = bet.status === "settled";
            return (
              <div key={bet.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-sm font-bold text-white">{bet.title}</h3>
                  {settled ? (
                    <span className="text-xs font-bold bg-amber-400/20 text-amber-300 px-2 py-1 rounded-full">
                      Pays {money(bet.prize ?? 0)}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-500 bg-gray-800 px-2 py-1 rounded-full">Open</span>
                  )}
                </div>
                {bet.description && <p className="text-xs text-gray-500 mb-2">{bet.description}</p>}
                {bet.entries.length === 0 ? (
                  <p className="text-xs text-gray-600 italic">No answers submitted.</p>
                ) : (
                  <table className="w-full text-xs mt-2">
                    <tbody>
                      {bet.entries.map((e) => {
                        const won = settled && e.entryId === bet.winnerEntryId;
                        return (
                          <tr key={e.entryId} className={`border-t border-gray-800 ${won ? "bg-amber-400/5" : ""}`}>
                            <td className="px-2 py-1.5 text-white font-medium whitespace-nowrap">
                              {won && <span className="mr-1">🏆</span>}
                              {e.userName ?? "Player"}
                            </td>
                            <td className="px-2 py-1.5 text-gray-200">{e.answer}</td>
                            <td className="px-2 py-1.5 text-right">
                              {won && (
                                <span className="inline-flex items-center text-xs font-bold px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-300">
                                  +{money(bet.prize ?? 0)}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
