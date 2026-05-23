"use client";

import { useState, useCallback } from "react";
import { ROUND_LABELS, ROUND_ORDER, type Round } from "@/lib/points";

type Team = {
  id: string;
  name: string;
  flag: string;
  group: string;
};

type SerializedMatch = {
  id: string;
  homeTeamId: string | null;
  awayTeamId: string | null;
  round: string;
  group: string | null;
  matchNumber: number;
  kickoff: string;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
  homeTeam: Team | null;
  awayTeam: Team | null;
};

type SerializedPrediction = {
  id: string;
  userId: string;
  matchId: string;
  homeScore: number;
  awayScore: number;
  points: number | null;
  createdAt: string;
  updatedAt: string;
};

type Props = {
  matches: SerializedMatch[];
  predictions: SerializedPrediction[];
};

type ScoreState = Record<string, { home: string; away: string }>;

export default function PredictionsClient({ matches, predictions }: Props) {
  const [activeRound, setActiveRound] = useState<Round>("Group");
  const [scores, setScores] = useState<ScoreState>(() => {
    const initial: ScoreState = {};
    for (const p of predictions) {
      initial[p.matchId] = {
        home: String(p.homeScore),
        away: String(p.awayScore),
      };
    }
    return initial;
  });
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<Record<Round, "idle" | "saved" | "error">>({
    Group: "idle",
    R32: "idle",
    R16: "idle",
    QF: "idle",
    SF: "idle",
    "3rd": "idle",
    Final: "idle",
  });

  // Filter rounds that have matches
  const availableRounds = ROUND_ORDER.filter((r) =>
    matches.some((m) => m.round === r)
  );

  const roundMatches = matches.filter((m) => m.round === activeRound);

  // Group stage matches by group letter
  const matchesByGroup: Record<string, SerializedMatch[]> = {};
  if (activeRound === "Group") {
    for (const match of roundMatches) {
      const g = match.group ?? "?";
      if (!matchesByGroup[g]) matchesByGroup[g] = [];
      matchesByGroup[g].push(match);
    }
  }

  const predMap = new Map(predictions.map((p) => [p.matchId, p]));

  const isLocked = (match: SerializedMatch) => {
    if (match.status === "finished" || match.status === "live") return true;
    return new Date(match.kickoff) <= new Date();
  };

  const handleScoreChange = (
    matchId: string,
    side: "home" | "away",
    value: string
  ) => {
    // Only allow digits 0-20
    const parsed = parseInt(value, 10);
    if (value !== "" && (isNaN(parsed) || parsed < 0 || parsed > 20)) return;
    setScores((prev) => ({
      ...prev,
      [matchId]: {
        home: side === "home" ? value : (prev[matchId]?.home ?? ""),
        away: side === "away" ? value : (prev[matchId]?.away ?? ""),
      },
    }));
  };

  const handleSave = useCallback(
    async (round: Round) => {
      const toSave = roundMatches
        .filter((m) => {
          if (isLocked(m)) return false;
          const s = scores[m.id];
          if (!s) return false;
          const h = parseInt(s.home, 10);
          const a = parseInt(s.away, 10);
          return !isNaN(h) && !isNaN(a);
        })
        .map((m) => ({
          matchId: m.id,
          homeScore: parseInt(scores[m.id].home, 10),
          awayScore: parseInt(scores[m.id].away, 10),
        }));

      if (toSave.length === 0) return;

      setSaving(true);
      try {
        const res = await fetch("/api/predictions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ predictions: toSave }),
        });
        if (!res.ok) throw new Error("Failed to save");
        setSaveStatus((prev) => ({ ...prev, [round]: "saved" }));
        setTimeout(() => setSaveStatus((prev) => ({ ...prev, [round]: "idle" })), 3000);
      } catch {
        setSaveStatus((prev) => ({ ...prev, [round]: "error" }));
        setTimeout(() => setSaveStatus((prev) => ({ ...prev, [round]: "idle" })), 3000);
      } finally {
        setSaving(false);
      }
    },
    [roundMatches, scores]
  );

  const renderMatchCard = (match: SerializedMatch) => {
    const locked = isLocked(match);
    const pred = predMap.get(match.id);
    const scoreState = scores[match.id];

    const kickoffDate = new Date(match.kickoff);
    const timeStr = kickoffDate.toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });

    const homeName = match.homeTeam?.name ?? "TBD";
    const awayName = match.awayTeam?.name ?? "TBD";
    const homeFlag = match.homeTeam?.flag ?? "🏳";
    const awayFlag = match.awayTeam?.flag ?? "🏳";

    return (
      <div
        key={match.id}
        className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col sm:flex-row items-center gap-4"
      >
        {/* Match number + time */}
        <div className="w-full sm:w-24 text-center shrink-0">
          <div className="text-xs text-gray-500 font-medium">#{match.matchNumber}</div>
          <div className="text-xs text-gray-400 mt-0.5">{timeStr}</div>
          {match.status === "live" && (
            <span className="inline-block mt-1 text-xs bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded">
              LIVE
            </span>
          )}
          {match.status === "finished" && (
            <span className="inline-block mt-1 text-xs bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded">
              FT
            </span>
          )}
        </div>

        {/* Teams + score inputs */}
        <div className="flex-1 flex items-center gap-3 w-full justify-center">
          {/* Home team */}
          <div className="flex items-center gap-2 flex-1 justify-end">
            <span className="text-sm font-semibold text-white text-right">{homeName}</span>
            <span className="text-2xl">{homeFlag}</span>
          </div>

          {/* Score inputs */}
          <div className="flex items-center gap-2">
            {locked ? (
              <>
                <div className="w-10 h-10 flex items-center justify-center bg-gray-800 rounded-lg text-white font-bold text-lg">
                  {scoreState?.home ?? (pred ? String(pred.homeScore) : "—")}
                </div>
                <span className="text-gray-400 font-bold">-</span>
                <div className="w-10 h-10 flex items-center justify-center bg-gray-800 rounded-lg text-white font-bold text-lg">
                  {scoreState?.away ?? (pred ? String(pred.awayScore) : "—")}
                </div>
              </>
            ) : (
              <>
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={scoreState?.home ?? ""}
                  onChange={(e) => handleScoreChange(match.id, "home", e.target.value)}
                  className="w-10 h-10 text-center bg-gray-800 border border-gray-700 focus:border-amber-400 rounded-lg text-white font-bold text-lg outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  placeholder="?"
                />
                <span className="text-gray-400 font-bold">-</span>
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={scoreState?.away ?? ""}
                  onChange={(e) => handleScoreChange(match.id, "away", e.target.value)}
                  className="w-10 h-10 text-center bg-gray-800 border border-gray-700 focus:border-amber-400 rounded-lg text-white font-bold text-lg outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  placeholder="?"
                />
              </>
            )}
          </div>

          {/* Away team */}
          <div className="flex items-center gap-2 flex-1 justify-start">
            <span className="text-2xl">{awayFlag}</span>
            <span className="text-sm font-semibold text-white">{awayName}</span>
          </div>
        </div>

        {/* Actual score + points */}
        <div className="w-full sm:w-28 text-center shrink-0">
          {match.status === "finished" &&
            match.homeScore !== null &&
            match.awayScore !== null && (
              <div className="text-xs text-gray-400 mb-1">
                Result: {match.homeScore}–{match.awayScore}
              </div>
            )}
          {locked && pred && pred.points !== null && (
            <div
              className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full ${
                pred.points > 0
                  ? "bg-amber-400/20 text-amber-400"
                  : "bg-gray-700 text-gray-400"
              }`}
            >
              {pred.points} pts
            </div>
          )}
          {locked && !pred && (
            <div className="text-xs text-gray-600 italic">No prediction</div>
          )}
        </div>
      </div>
    );
  };

  const saveBtn = (round: Round) => {
    const status = saveStatus[round];
    const unlockedCount = roundMatches.filter((m) => !isLocked(m) && scores[m.id]).length;
    return (
      <button
        onClick={() => handleSave(round)}
        disabled={saving || unlockedCount === 0}
        className={`px-6 py-2.5 rounded-xl font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          status === "saved"
            ? "bg-green-500 text-white"
            : status === "error"
            ? "bg-red-500 text-white"
            : "bg-amber-400 hover:bg-amber-300 text-gray-900"
        }`}
      >
        {status === "saved"
          ? "Saved!"
          : status === "error"
          ? "Error — try again"
          : saving
          ? "Saving..."
          : "Save predictions"}
      </button>
    );
  };

  return (
    <div>
      {/* Round tabs */}
      <div className="flex flex-wrap gap-2 mb-8">
        {availableRounds.map((r) => (
          <button
            key={r}
            onClick={() => setActiveRound(r)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeRound === r
                ? "bg-amber-400 text-gray-900"
                : "bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white"
            }`}
          >
            {ROUND_LABELS[r]}
          </button>
        ))}
      </div>

      {/* Group stage: grouped by group letter */}
      {activeRound === "Group" ? (
        <div className="space-y-8">
          {Object.keys(matchesByGroup)
            .sort()
            .map((group) => (
              <div key={group}>
                <h3 className="text-amber-400 font-bold text-lg mb-3">
                  Group {group}
                </h3>
                <div className="space-y-3">
                  {matchesByGroup[group].map(renderMatchCard)}
                </div>
              </div>
            ))}
          <div className="flex justify-end pt-4">
            {saveBtn("Group")}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {roundMatches.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <div className="text-4xl mb-3">🔒</div>
              <p>Matches for this round will appear once the previous round concludes.</p>
            </div>
          ) : (
            <>
              {roundMatches.map(renderMatchCard)}
              <div className="flex justify-end pt-4">
                {saveBtn(activeRound)}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
