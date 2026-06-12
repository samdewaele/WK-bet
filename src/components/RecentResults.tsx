"use client";

import { useEffect, useState } from "react";
import TeamFlag from "@/components/TeamFlag";

type Match = {
  id: string;
  round: string;
  group: string | null;
  kickoff: string;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
  homeTeam: { id: string; name: string; flag: string } | null;
  awayTeam: { id: string; name: string; flag: string } | null;
};

const ROUND_LABEL: Record<string, string> = {
  R32: "R32", R16: "R16", QF: "QF", SF: "SF", "3rd": "3rd", Final: "Final",
};

export default function RecentResults() {
  const [recent, setRecent] = useState<Match[]>([]);

  useEffect(() => {
    fetch("/api/matches")
      .then((r) => r.json())
      .then((data: Match[]) => {
        const finished = data
          .filter((m) => m.status === "finished" && m.homeTeam && m.awayTeam)
          .sort((a, b) => new Date(b.kickoff).getTime() - new Date(a.kickoff).getTime())
          .slice(0, 5);
        setRecent(finished);
      })
      .catch(() => {});
  }, []);

  if (recent.length === 0) return null;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-6">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Recent Results</h3>
      <div className="space-y-2">
        {recent.map((m) => {
          const label = m.round === "Group" ? `Group ${m.group}` : (ROUND_LABEL[m.round] ?? m.round);
          return (
            <div key={m.id} className="flex items-center gap-2 text-sm">
              <span className="text-xs text-gray-600 w-14 shrink-0">{label}</span>
              <div className="flex-1 flex items-center justify-end gap-1.5 min-w-0">
                <span className="text-gray-300 truncate text-right">{m.homeTeam!.name}</span>
                <TeamFlag flag={m.homeTeam!.flag} name={m.homeTeam!.name} size={14} />
              </div>
              <div className="font-mono font-bold text-white bg-gray-800 px-2 py-0.5 rounded text-xs tabular-nums shrink-0">
                {m.homeScore} – {m.awayScore}
              </div>
              <div className="flex-1 flex items-center gap-1.5 min-w-0">
                <TeamFlag flag={m.awayTeam!.flag} name={m.awayTeam!.name} size={14} />
                <span className="text-gray-300 truncate">{m.awayTeam!.name}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
