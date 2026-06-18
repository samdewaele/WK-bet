"use client";

import { useEffect, useRef, useState } from "react";
import TeamFlag from "@/components/TeamFlag";
import { filterRecentResults, filterLiveMatches, type RecentMatch } from "@/lib/recent-results";
import { formatDate } from "@/lib/format-date";

const ROUND_LABEL: Record<string, string> = {
  R32: "R32", R16: "R16", QF: "QF", SF: "SF", "3rd": "3rd", Final: "Final",
};

const POLL_LIVE_MS = 10_000; // match server-side live sync interval
const POLL_IDLE_MS = 60_000; // no live matches — check once a minute

function MatchRow({ m, live = false }: { m: RecentMatch; live?: boolean }) {
  const label = m.round === "Group" ? `Group ${m.group}` : (ROUND_LABEL[m.round] ?? m.round);
  return (
    <div className="flex items-center gap-2 text-sm">
      <div className="shrink-0 w-16">
        <div className="text-xs text-gray-600">{label}</div>
        <div className="text-xs text-gray-700">{live ? "LIVE" : formatDate(m.kickoff)}</div>
      </div>
      <div className="flex-1 flex items-center justify-end gap-1.5 min-w-0">
        <span className="text-gray-300 truncate text-right">{m.homeTeam!.name}</span>
        <TeamFlag flag={m.homeTeam!.flag} name={m.homeTeam!.name} size={14} />
      </div>
      <div className={`font-mono font-bold px-2 py-0.5 rounded text-xs tabular-nums shrink-0 ${
        live ? "text-green-400 bg-green-950 border border-green-800" : "text-white bg-gray-800"
      }`}>
        {m.homeScore ?? 0} – {m.awayScore ?? 0}
      </div>
      <div className="flex-1 flex items-center gap-1.5 min-w-0">
        <TeamFlag flag={m.awayTeam!.flag} name={m.awayTeam!.name} size={14} />
        <span className="text-gray-300 truncate">{m.awayTeam!.name}</span>
      </div>
    </div>
  );
}

export default function RecentResults() {
  const [all, setAll] = useState<RecentMatch[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadMatches = () => {
    fetch("/api/matches")
      .then((r) => r.json())
      .then((data: RecentMatch[]) => {
        setAll(data);
        // Schedule next poll — fast when live, slow otherwise
        const hasLive = data.some((m) => m.status === "live");
        timerRef.current = setTimeout(loadMatches, hasLive ? POLL_LIVE_MS : POLL_IDLE_MS);
      })
      .catch(() => {
        timerRef.current = setTimeout(loadMatches, POLL_IDLE_MS);
      });
  };

  useEffect(() => {
    loadMatches();
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const live = filterLiveMatches(all);
  const recent = filterRecentResults(all);

  if (live.length === 0 && recent.length === 0) return null;

  return (
    <div className="space-y-4 mb-6">
      {live.length > 0 && (
        <div className="bg-gray-900 border border-green-900 rounded-xl p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider mb-3 flex items-center gap-2 text-green-500">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
            </span>
            Live Now
          </h3>
          <div className="space-y-2">
            {live.map((m) => <MatchRow key={m.id} m={m} live />)}
          </div>
        </div>
      )}

      {recent.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Recent Results</h3>
          <div className="space-y-2">
            {recent.map((m) => <MatchRow key={m.id} m={m} />)}
          </div>
        </div>
      )}
    </div>
  );
}
