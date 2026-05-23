"use client";

import { useState } from "react";
import { ROUND_LABELS, ROUND_ORDER, type Round } from "@/lib/points";

type Team = {
  id: string;
  name: string;
  flag: string;
};

type AdminMatch = {
  id: string;
  matchNumber: number;
  round: string;
  group: string | null;
  kickoff: string;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
  homeTeam: Team | null;
  awayTeam: Team | null;
};

type EditState = {
  homeScore: string;
  awayScore: string;
  status: string;
};

type Props = {
  matches: AdminMatch[];
};

export default function AdminMatchList({ matches: initialMatches }: Props) {
  const [matches, setMatches] = useState<AdminMatch[]>(initialMatches);
  const [editMap, setEditMap] = useState<Record<string, EditState>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveResult, setSaveResult] = useState<Record<string, "saved" | "error">>({});
  const [activeRound, setActiveRound] = useState<string>("Group");

  const availableRounds = ROUND_ORDER.filter((r) =>
    matches.some((m) => m.round === r)
  );

  const roundMatches = matches.filter((m) => m.round === activeRound);

  const getEdit = (match: AdminMatch): EditState => {
    return (
      editMap[match.id] ?? {
        homeScore: match.homeScore !== null ? String(match.homeScore) : "",
        awayScore: match.awayScore !== null ? String(match.awayScore) : "",
        status: match.status,
      }
    );
  };

  const updateEdit = (matchId: string, field: keyof EditState, value: string) => {
    setEditMap((prev) => ({
      ...prev,
      [matchId]: {
        ...(prev[matchId] ?? getEdit(matches.find((m) => m.id === matchId)!)),
        [field]: value,
      },
    }));
  };

  const handleSave = async (match: AdminMatch) => {
    const edit = getEdit(match);
    const homeScore = edit.homeScore === "" ? null : parseInt(edit.homeScore, 10);
    const awayScore = edit.awayScore === "" ? null : parseInt(edit.awayScore, 10);

    if (
      edit.homeScore !== "" && (isNaN(homeScore as number) || (homeScore as number) < 0) ||
      edit.awayScore !== "" && (isNaN(awayScore as number) || (awayScore as number) < 0)
    ) {
      return;
    }

    setSavingId(match.id);
    try {
      const res = await fetch(`/api/admin/matches/${match.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          homeScore,
          awayScore,
          status: edit.status,
        }),
      });

      if (!res.ok) throw new Error("Failed to save");

      const updated = await res.json();
      setMatches((prev) =>
        prev.map((m) =>
          m.id === match.id
            ? { ...m, homeScore: updated.homeScore, awayScore: updated.awayScore, status: updated.status }
            : m
        )
      );
      // Clear edit state for this match
      setEditMap((prev) => {
        const next = { ...prev };
        delete next[match.id];
        return next;
      });
      setSaveResult((prev) => ({ ...prev, [match.id]: "saved" }));
      setTimeout(() => setSaveResult((prev) => {
        const next = { ...prev };
        delete next[match.id];
        return next;
      }), 3000);
    } catch {
      setSaveResult((prev) => ({ ...prev, [match.id]: "error" }));
      setTimeout(() => setSaveResult((prev) => {
        const next = { ...prev };
        delete next[match.id];
        return next;
      }), 3000);
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div>
      {/* Round tabs */}
      <div className="flex flex-wrap gap-2 mb-6">
        {availableRounds.map((r) => (
          <button
            key={r}
            onClick={() => setActiveRound(r)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeRound === r
                ? "bg-amber-400 text-gray-900"
                : "bg-gray-800 text-gray-300 hover:bg-gray-700"
            }`}
          >
            {ROUND_LABELS[r as Round]}
          </button>
        ))}
      </div>

      {/* Match table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">#</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Match</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold hidden sm:table-cell">Kickoff</th>
                <th className="text-center py-3 px-4 text-gray-400 font-semibold">Score</th>
                <th className="text-center py-3 px-4 text-gray-400 font-semibold">Status</th>
                <th className="text-center py-3 px-4 text-gray-400 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {roundMatches.map((match) => {
                const edit = getEdit(match);
                const result = saveResult[match.id];
                const isSaving = savingId === match.id;

                const homeName = match.homeTeam?.name ?? "TBD";
                const awayName = match.awayTeam?.name ?? "TBD";
                const homeFlag = match.homeTeam?.flag ?? "🏳";
                const awayFlag = match.awayTeam?.flag ?? "🏳";

                const kickoff = new Date(match.kickoff).toLocaleString("en-GB", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                });

                return (
                  <tr key={match.id} className="border-b border-gray-800 hover:bg-gray-800/30">
                    <td className="py-3 px-4 text-gray-500">{match.matchNumber}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2 text-white font-medium">
                        <span>{homeFlag}</span>
                        <span className="truncate max-w-[80px]">{homeName}</span>
                        <span className="text-gray-500">vs</span>
                        <span>{awayFlag}</span>
                        <span className="truncate max-w-[80px]">{awayName}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-gray-400 text-xs hidden sm:table-cell">
                      {kickoff}
                    </td>

                    {/* Score inputs */}
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-center gap-2">
                        <input
                          type="number"
                          min={0}
                          max={99}
                          value={edit.homeScore}
                          onChange={(e) => updateEdit(match.id, "homeScore", e.target.value)}
                          className="w-12 h-8 text-center bg-gray-800 border border-gray-700 focus:border-amber-400 rounded text-white text-sm outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          placeholder="–"
                        />
                        <span className="text-gray-400">-</span>
                        <input
                          type="number"
                          min={0}
                          max={99}
                          value={edit.awayScore}
                          onChange={(e) => updateEdit(match.id, "awayScore", e.target.value)}
                          className="w-12 h-8 text-center bg-gray-800 border border-gray-700 focus:border-amber-400 rounded text-white text-sm outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          placeholder="–"
                        />
                      </div>
                    </td>

                    {/* Status select */}
                    <td className="py-3 px-4">
                      <select
                        value={edit.status}
                        onChange={(e) => updateEdit(match.id, "status", e.target.value)}
                        className="bg-gray-800 border border-gray-700 focus:border-amber-400 rounded px-2 py-1 text-white text-xs outline-none"
                      >
                        <option value="scheduled">Scheduled</option>
                        <option value="live">Live</option>
                        <option value="finished">Finished</option>
                      </select>
                    </td>

                    {/* Save button */}
                    <td className="py-3 px-4 text-center">
                      <button
                        onClick={() => handleSave(match)}
                        disabled={isSaving}
                        className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${
                          result === "saved"
                            ? "bg-green-500/20 text-green-400"
                            : result === "error"
                            ? "bg-red-500/20 text-red-400"
                            : "bg-amber-400/20 hover:bg-amber-400/30 text-amber-400"
                        }`}
                      >
                        {isSaving
                          ? "Saving…"
                          : result === "saved"
                          ? "Saved!"
                          : result === "error"
                          ? "Error"
                          : "Save"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
