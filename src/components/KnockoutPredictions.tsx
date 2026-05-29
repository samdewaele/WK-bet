"use client";

import { useState, useEffect, useCallback } from "react";
import TeamFlag from "@/components/TeamFlag";

type Team = {
  id: string;
  name: string;
  flag: string;
};

type Match = {
  id: string;
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

type Prediction = {
  id: string;
  matchId: string;
  homeScore: number;
  awayScore: number;
  earnedAmount: number | null;
  predicted: boolean;
  match: Match;
};

type Props = {
  roomId: string;
};

const KO_ROUNDS = ["R32", "R16", "QF", "SF", "3rd", "Final"] as const;
const ROUND_LABELS: Record<string, string> = {
  R32: "Round of 32",
  R16: "Round of 16",
  QF: "Quarter-finals",
  SF: "Semi-finals",
  "3rd": "3rd Place",
  Final: "Final",
};

type ScoreState = Record<string, { home: string; away: string }>;
type RoundSaveStatus = "idle" | "saved" | "error" | "locked";

export default function KnockoutPredictions({ roomId }: Props) {
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [scores, setScores] = useState<ScoreState>({});
  const [activeRound, setActiveRound] = useState<string>("R32");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<Record<string, RoundSaveStatus>>({});
  const [saveError, setSaveError] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`/api/groups/${roomId}/knockout`);
        if (!res.ok) return;
        const data: Prediction[] = await res.json();
        setPredictions(data);

        // Only pre-fill scores for matches the user has already predicted
        const initial: ScoreState = {};
        for (const p of data) {
          if (p.predicted) {
            initial[p.matchId] = {
              home: String(p.homeScore),
              away: String(p.awayScore),
            };
          }
        }
        setScores(initial);

        const firstRound = KO_ROUNDS.find((r) => data.some((p) => p.match.round === r));
        if (firstRound) setActiveRound(firstRound);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [roomId]);

  // predMap only tracks actual predictions (predicted: true) for score display and earned amounts
  const predMap = new Map(predictions.filter((p) => p.predicted).map((p) => [p.matchId, p]));

  const roundMatches = predictions
    .filter((p) => p.match.round === activeRound)
    .map((p) => p.match);

  // Show all rounds that have matches (not just ones with predictions)
  const availableRounds = KO_ROUNDS.filter((r) =>
    predictions.some((p) => p.match.round === r)
  );

  const isLocked = (match: Match) => {
    if (match.status === "finished" || match.status === "live") return true;
    return new Date(match.kickoff) <= new Date();
  };

  const handleScoreChange = (matchId: string, side: "home" | "away", value: string) => {
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
    async (round: string) => {
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
        const res = await fetch(`/api/groups/${roomId}/knockout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ predictions: toSave }),
        });
        if (!res.ok) {
          let errorMsg = "Error — try again";
          try {
            const errData = await res.json();
            if (errData.error && errData.error.toLowerCase().includes("locked")) {
              setSaveStatus((prev) => ({ ...prev, [round]: "locked" }));
              setSaveError((prev) => ({ ...prev, [round]: "Predictions are closed for this group" }));
              setTimeout(() => {
                setSaveStatus((prev) => ({ ...prev, [round]: "idle" }));
                setSaveError((prev) => ({ ...prev, [round]: "" }));
              }, 5000);
              return;
            }
            errorMsg = errData.error ?? errorMsg;
          } catch {
            // ignore JSON parse errors
          }
          setSaveStatus((prev) => ({ ...prev, [round]: "error" }));
          setSaveError((prev) => ({ ...prev, [round]: errorMsg }));
          setTimeout(() => {
            setSaveStatus((prev) => ({ ...prev, [round]: "idle" }));
            setSaveError((prev) => ({ ...prev, [round]: "" }));
          }, 3000);
          return;
        }
        setSaveStatus((prev) => ({ ...prev, [round]: "saved" }));
        setTimeout(() => setSaveStatus((prev) => ({ ...prev, [round]: "idle" })), 3000);
      } catch {
        setSaveStatus((prev) => ({ ...prev, [round]: "error" }));
        setSaveError((prev) => ({ ...prev, [round]: "Error — try again" }));
        setTimeout(() => {
          setSaveStatus((prev) => ({ ...prev, [round]: "idle" }));
          setSaveError((prev) => ({ ...prev, [round]: "" }));
        }, 3000);
      } finally {
        setSaving(false);
      }
    },
    [roomId, roundMatches, scores]
  );

  if (loading) {
    return <div className="animate-pulse bg-gray-900 border border-gray-800 rounded-xl h-48" />;
  }

  if (availableRounds.length === 0) {
    const BRACKET = [
      { label: "Round of 32", matches: 32 },
      { label: "Round of 16", matches: 16 },
      { label: "Quarter-finals", matches: 8 },
      { label: "Semi-finals", matches: 4 },
      { label: "3rd Place", matches: 1 },
      { label: "Final", matches: 1 },
    ];
    return (
      <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
        <div className="text-center mb-6">
          <div className="text-3xl mb-2">🏆</div>
          <p className="text-white font-semibold text-lg">Knockout bracket opens after group stage</p>
          <p className="text-gray-500 text-sm mt-1">
            Predict all 63 knockout matches — picks lock at each match&apos;s kickoff
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {BRACKET.map((b) => (
            <div key={b.label} className="bg-gray-800 border border-gray-700 rounded-lg p-3 text-center opacity-50">
              <div className="text-xs text-gray-400 mb-1 font-medium">{b.label}</div>
              <div className="text-2xl font-bold text-gray-500">{b.matches}</div>
              <div className="text-xs text-gray-600">match{b.matches > 1 ? "es" : ""}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const renderMatch = (match: Match) => {
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

    return (
      <div
        key={match.id}
        className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col sm:flex-row items-center gap-4"
      >
        <div className="w-full sm:w-24 text-center shrink-0">
          <div className="text-xs text-gray-500">#{match.matchNumber}</div>
          <div className="text-xs text-gray-400 mt-0.5">{timeStr}</div>
          {match.status === "live" && (
            <span className="inline-block mt-1 text-xs bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded">LIVE</span>
          )}
          {match.status === "finished" && (
            <span className="inline-block mt-1 text-xs bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded">FT</span>
          )}
        </div>

        <div className="flex-1 flex items-center gap-3 w-full justify-center">
          <div className="flex items-center gap-2 flex-1 justify-end">
            <span className="text-sm font-semibold text-white text-right">
              {match.homeTeam?.name ?? "TBD"}
            </span>
            {match.homeTeam ? (
              <TeamFlag flag={match.homeTeam.flag} name={match.homeTeam.name} size={28} />
            ) : (
              <span className="text-2xl">🏳</span>
            )}
          </div>

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

          <div className="flex items-center gap-2 flex-1 justify-start">
            {match.awayTeam ? (
              <TeamFlag flag={match.awayTeam.flag} name={match.awayTeam.name} size={28} />
            ) : (
              <span className="text-2xl">🏳</span>
            )}
            <span className="text-sm font-semibold text-white">{match.awayTeam?.name ?? "TBD"}</span>
          </div>
        </div>

        <div className="w-full sm:w-28 text-center shrink-0">
          {match.status === "finished" && match.homeScore !== null && match.awayScore !== null && (
            <div className="text-xs text-gray-400 mb-1">
              Result: {match.homeScore}–{match.awayScore}
            </div>
          )}
          {locked && pred?.earnedAmount != null && (
            <div
              className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full ${
                pred.earnedAmount > 0
                  ? "bg-amber-400/20 text-amber-400"
                  : "bg-gray-700 text-gray-400"
              }`}
            >
              €{pred.earnedAmount.toFixed(2)}
            </div>
          )}
          {locked && !pred && (
            <div className="text-xs text-gray-600 italic">No prediction</div>
          )}
        </div>
      </div>
    );
  };

  const status = saveStatus[activeRound] ?? "idle";
  const errMsg = saveError[activeRound] ?? "";
  const unlockedCount = roundMatches.filter((m) => !isLocked(m) && scores[m.id]).length;

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-6">
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
            {ROUND_LABELS[r] ?? r}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {roundMatches.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <p>No matches for this round yet.</p>
          </div>
        ) : (
          <>
            {roundMatches.map(renderMatch)}
            <div className="flex flex-col items-end gap-2 pt-4">
              {status === "locked" && errMsg && (
                <p className="text-sm text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2">
                  🔒 {errMsg}
                </p>
              )}
              {status === "error" && errMsg && (
                <p className="text-sm text-red-400">{errMsg}</p>
              )}
              <button
                onClick={() => handleSave(activeRound)}
                disabled={saving || unlockedCount === 0}
                className={`px-6 py-2.5 rounded-xl font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  status === "saved"
                    ? "bg-green-500 text-white"
                    : status === "error" || status === "locked"
                    ? "bg-red-500 text-white"
                    : "bg-amber-400 hover:bg-amber-300 text-gray-900"
                }`}
              >
                {status === "saved"
                  ? "Saved!"
                  : status === "error"
                  ? "Error — try again"
                  : status === "locked"
                  ? "Predictions closed"
                  : saving
                  ? "Saving..."
                  : "Save predictions"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
