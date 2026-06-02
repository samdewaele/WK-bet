"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
  penaltyWinner: "home" | "away" | null;
  earnedAmount: number | null;
  predicted: boolean;
  match: Match;
};

type Props = {
  roomId: string;
  roomStatus?: string;
  simulationMode?: boolean;
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

// Static source labels for each R32 match slot (matchNumber → home/away label).
// Derived from the official FIFA WC 2026 bracket seeding rules in ko-seeding.ts.
const R32_SOURCE_LABELS: Record<number, { home: string; away: string }> = {
  73:  { home: "2nd A",                   away: "2nd B" },
  74:  { home: "1st E",                   away: "Best 3rd (A/B/C/D/F)" },
  75:  { home: "1st F",                   away: "2nd C" },
  76:  { home: "1st C",                   away: "2nd F" },
  77:  { home: "1st I",                   away: "Best 3rd (C/D/F/G/H)" },
  78:  { home: "2nd E",                   away: "2nd I" },
  79:  { home: "1st A",                   away: "Best 3rd (C/E/F/H/I)" },
  80:  { home: "1st L",                   away: "Best 3rd (E/H/I/J/K)" },
  81:  { home: "1st D",                   away: "Best 3rd (B/E/F/I/J)" },
  82:  { home: "1st G",                   away: "Best 3rd (A/E/H/I/J)" },
  83:  { home: "2nd K",                   away: "2nd L" },
  84:  { home: "1st H",                   away: "2nd J" },
  85:  { home: "1st B",                   away: "Best 3rd (E/F/G/I/J)" },
  86:  { home: "1st J",                   away: "2nd H" },
  87:  { home: "1st K",                   away: "Best 3rd (D/E/I/J/L)" },
  88:  { home: "2nd D",                   away: "2nd G" },
};

const BRACKET_PATH: Record<number, {
  home: { matchNum: number; side: "winner" | "loser" };
  away: { matchNum: number; side: "winner" | "loser" };
}> = {
  89:  { home: { matchNum: 73, side: "winner" }, away: { matchNum: 74, side: "winner" } },
  90:  { home: { matchNum: 75, side: "winner" }, away: { matchNum: 76, side: "winner" } },
  91:  { home: { matchNum: 77, side: "winner" }, away: { matchNum: 78, side: "winner" } },
  92:  { home: { matchNum: 79, side: "winner" }, away: { matchNum: 80, side: "winner" } },
  93:  { home: { matchNum: 81, side: "winner" }, away: { matchNum: 82, side: "winner" } },
  94:  { home: { matchNum: 83, side: "winner" }, away: { matchNum: 84, side: "winner" } },
  95:  { home: { matchNum: 85, side: "winner" }, away: { matchNum: 86, side: "winner" } },
  96:  { home: { matchNum: 87, side: "winner" }, away: { matchNum: 88, side: "winner" } },
  97:  { home: { matchNum: 89, side: "winner" }, away: { matchNum: 90, side: "winner" } },
  98:  { home: { matchNum: 91, side: "winner" }, away: { matchNum: 92, side: "winner" } },
  99:  { home: { matchNum: 93, side: "winner" }, away: { matchNum: 94, side: "winner" } },
  100: { home: { matchNum: 95, side: "winner" }, away: { matchNum: 96, side: "winner" } },
  101: { home: { matchNum: 97,  side: "winner" }, away: { matchNum: 98,  side: "winner" } },
  102: { home: { matchNum: 99,  side: "winner" }, away: { matchNum: 100, side: "winner" } },
  103: { home: { matchNum: 101, side: "loser"  }, away: { matchNum: 102, side: "loser"  } },
  104: { home: { matchNum: 101, side: "winner" }, away: { matchNum: 102, side: "winner" } },
};

type ScoreState = Record<string, { home: string; away: string }>;
type MatchSaveStatus = "idle" | "saving" | "saved" | "error";

function randomKOScore(): { home: number; away: number } {
  const goals = () => {
    const r = Math.random();
    if (r < 0.28) return 0;
    if (r < 0.60) return 1;
    if (r < 0.82) return 2;
    if (r < 0.95) return 3;
    return 4;
  };
  let home: number, away: number;
  do { home = goals(); away = goals(); } while (home === away);
  return { home, away };
}

export default function KnockoutPredictions({ roomId, roomStatus, simulationMode }: Props) {
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [scores, setScores] = useState<ScoreState>({});
  const [penaltyWinners, setPenaltyWinners] = useState<Record<string, "home" | "away">>({});
  const [activeRound, setActiveRound] = useState<string>("R32");
  const [matchSaveStatus, setMatchSaveStatus] = useState<Record<string, MatchSaveStatus>>({});
  const [globalSaving, setGlobalSaving] = useState(false);
  const [globalStatus, setGlobalStatus] = useState<"idle" | "saved" | "error">("idle");
  const [loading, setLoading] = useState(true);
  const debounceRefs = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`/api/groups/${roomId}/knockout`);
        if (!res.ok) return;
        const data: Prediction[] = await res.json();
        setPredictions(data);

        const initial: ScoreState = {};
        const initialPw: Record<string, "home" | "away"> = {};
        for (const p of data) {
          if (p.predicted) {
            initial[p.matchId] = {
              home: String(p.homeScore),
              away: String(p.awayScore),
            };
            if (p.penaltyWinner) initialPw[p.matchId] = p.penaltyWinner;
          }
        }
        setScores(initial);
        setPenaltyWinners(initialPw);

        const firstRound = KO_ROUNDS.find((r) => data.some((p) => p.match.round === r));
        if (firstRound) setActiveRound(firstRound);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [roomId, roomStatus]);

  const matchByNum = new Map(predictions.map((p) => [p.match.matchNumber, p.match]));

  function getSlotLabel(matchNumber: number, side: "home" | "away"): string {
    const r32 = R32_SOURCE_LABELS[matchNumber];
    if (r32) return side === "home" ? r32.home : r32.away;
    const path = BRACKET_PATH[matchNumber];
    if (!path) return "TBD";
    const ref = side === "home" ? path.home : path.away;
    return ref.side === "winner" ? `W M${ref.matchNum}` : `L M${ref.matchNum}`;
  }
  const predMap = new Map(predictions.filter((p) => p.predicted).map((p) => [p.matchId, p]));

  const getEffectiveScore = (matchId: string): { h: number; a: number; pw: "home" | "away" | null } | null => {
    const s = scores[matchId];
    if (s && s.home !== "" && s.away !== "") {
      const h = parseInt(s.home, 10);
      const a = parseInt(s.away, 10);
      if (!isNaN(h) && !isNaN(a)) {
        return { h, a, pw: penaltyWinners[matchId] ?? null };
      }
    }
    const saved = predMap.get(matchId);
    if (saved) return { h: saved.homeScore, a: saved.awayScore, pw: saved.penaltyWinner ?? null };
    return null;
  };

  function resolveProjectedTeam(matchNum: number, side: "winner" | "loser"): Team | null {
    const match = matchByNum.get(matchNum);
    if (!match) return null;

    let homeTeam: Team | null;
    let awayTeam: Team | null;

    if (match.round === "R32") {
      homeTeam = match.homeTeam;
      awayTeam = match.awayTeam;
    } else {
      const path = BRACKET_PATH[matchNum];
      if (!path) return null;
      homeTeam = resolveProjectedTeam(path.home.matchNum, path.home.side);
      awayTeam = resolveProjectedTeam(path.away.matchNum, path.away.side);
    }

    const score = getEffectiveScore(match.id);
    if (!score) return null;

    let homeWins: boolean;
    if (score.h !== score.a) {
      homeWins = score.h > score.a;
    } else if (score.pw) {
      homeWins = score.pw === "home";
    } else {
      return null; // tie with no penalty winner yet
    }

    if (side === "winner") return homeWins ? homeTeam : awayTeam;
    return homeWins ? awayTeam : homeTeam;
  }

  function getDisplayTeams(match: Match): { home: Team | null; away: Team | null } {
    if (match.round === "R32") return { home: match.homeTeam, away: match.awayTeam };
    const path = BRACKET_PATH[match.matchNumber];
    if (!path) return { home: null, away: null };
    return {
      home: resolveProjectedTeam(path.home.matchNum, path.home.side),
      away: resolveProjectedTeam(path.away.matchNum, path.away.side),
    };
  }

  const roundMatches = predictions
    .filter((p) => p.match.round === activeRound)
    .map((p) => p.match);

  const availableRounds = KO_ROUNDS.filter((r) =>
    predictions.some((p) => p.match.round === r)
  );

  const allKOLocked = roomStatus !== "ko_betting";

  const isLocked = (match: Match) => {
    if (allKOLocked) return true;
    if (match.status === "finished" || match.status === "live") return true;
    return new Date(match.kickoff) <= new Date();
  };

  const isTied = (matchId: string) => {
    const s = scores[matchId];
    if (!s || s.home === "" || s.away === "") return false;
    const h = parseInt(s.home, 10);
    const a = parseInt(s.away, 10);
    return !isNaN(h) && !isNaN(a) && h === a;
  };

  async function saveMatches(matches: Match[]) {
    const toSave = matches
      .filter((m) => {
        if (isLocked(m)) return false;
        const s = scores[m.id];
        if (!s) return false;
        const h = parseInt(s.home, 10);
        const a = parseInt(s.away, 10);
        if (isNaN(h) || isNaN(a)) return false;
        if (h === a && !penaltyWinners[m.id]) return false; // tied but no penalty winner
        return true;
      })
      .map((m) => ({
        matchId: m.id,
        homeScore: parseInt(scores[m.id].home, 10),
        awayScore: parseInt(scores[m.id].away, 10),
        penaltyWinner: isTied(m.id) ? (penaltyWinners[m.id] ?? null) : null,
      }));

    if (toSave.length === 0) return { ok: true, saved: 0 };

    const res = await fetch(`/api/groups/${roomId}/knockout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ predictions: toSave }),
    });
    return { ok: res.ok, saved: toSave.length, res };
  }

  const autoSaveMatch = useCallback(async (match: Match) => {
    if (isLocked(match)) return;
    const s = scores[match.id];
    if (!s) return;
    const h = parseInt(s.home, 10);
    const a = parseInt(s.away, 10);
    if (isNaN(h) || isNaN(a)) return;
    if (h === a && !penaltyWinners[match.id]) return;

    setMatchSaveStatus((prev) => ({ ...prev, [match.id]: "saving" }));
    const { ok } = await saveMatches([match]);
    setMatchSaveStatus((prev) => ({
      ...prev,
      [match.id]: ok ? "saved" : "error",
    }));
    if (ok) {
      setTimeout(() => setMatchSaveStatus((prev) => ({ ...prev, [match.id]: "idle" })), 2000);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, scores, penaltyWinners]);

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

  const handlePenaltyChange = (matchId: string, winner: "home" | "away") => {
    setPenaltyWinners((prev) => ({ ...prev, [matchId]: winner }));
  };

  // Trigger auto-save after score or penalty winner changes
  useEffect(() => {
    if (allKOLocked) return;
    for (const match of roundMatches) {
      const s = scores[match.id];
      if (!s || s.home === "" || s.away === "") continue;
      const h = parseInt(s.home, 10);
      const a = parseInt(s.away, 10);
      if (isNaN(h) || isNaN(a)) continue;
      if (h === a && !penaltyWinners[match.id]) continue;

      if (debounceRefs.current[match.id]) clearTimeout(debounceRefs.current[match.id]);
      debounceRefs.current[match.id] = setTimeout(() => autoSaveMatch(match), 700);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scores, penaltyWinners, activeRound]);

  const handleSaveAll = useCallback(async () => {
    const allMatches = predictions.map((p) => p.match);
    setGlobalSaving(true);
    setGlobalStatus("idle");
    const { ok } = await saveMatches(allMatches);
    setGlobalSaving(false);
    setGlobalStatus(ok ? "saved" : "error");
    setTimeout(() => setGlobalStatus("idle"), 3000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, predictions, scores, penaltyWinners]);

  const handlePickForMe = useCallback(async () => {
    const newScores: ScoreState = { ...scores };
    for (const pred of predictions) {
      if (isLocked(pred.match)) continue;
      const { home, away } = randomKOScore();
      newScores[pred.match.id] = { home: String(home), away: String(away) };
    }
    setScores(newScores);
    // Clear any stale penalty winners (all random scores are decisive)
    setPenaltyWinners({});

    // Save all immediately using the fresh scores (avoids stale closure)
    const toSave = predictions
      .map((p) => p.match)
      .filter((m) => !isLocked(m) && newScores[m.id])
      .map((m) => ({
        matchId: m.id,
        homeScore: parseInt(newScores[m.id].home, 10),
        awayScore: parseInt(newScores[m.id].away, 10),
        penaltyWinner: null as null | "home" | "away",
      }));

    if (toSave.length === 0) return;
    setGlobalSaving(true);
    setGlobalStatus("idle");
    const res = await fetch(`/api/groups/${roomId}/knockout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ predictions: toSave }),
    });
    setGlobalSaving(false);
    setGlobalStatus(res.ok ? "saved" : "error");
    setTimeout(() => setGlobalStatus("idle"), 3000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, predictions, scores]);

  if (loading) {
    return <div className="animate-pulse bg-gray-900 border border-gray-800 rounded-xl h-48" />;
  }

  if (availableRounds.length === 0) {
    const BRACKET = [
      { label: "Round of 32", matches: 16 },
      { label: "Round of 16", matches: 8 },
      { label: "Quarter-finals", matches: 4 },
      { label: "Semi-finals", matches: 2 },
      { label: "3rd Place", matches: 1 },
      { label: "Final", matches: 1 },
    ];
    return (
      <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
        <div className="text-center mb-6">
          <div className="text-3xl mb-2">🏆</div>
          <p className="text-white font-semibold text-lg">Knockout bracket opens after group stage</p>
          <p className="text-gray-500 text-sm mt-1">
            Predict all 32 knockout matches — all picks lock when the KO stage begins
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

  const renderTeamSlot = (team: Team | null, side: "home" | "away", label?: string) => {
    const alignClass = side === "home" ? "justify-end text-right" : "justify-start text-left";
    const flagFirst = side === "away";
    if (!team) {
      return (
        <div className={`flex items-center gap-2 flex-1 ${alignClass}`}>
          <span className="text-sm text-gray-500 italic">{label ?? "TBD"}</span>
        </div>
      );
    }
    return (
      <div className={`flex items-center gap-2 flex-1 ${alignClass}`}>
        {flagFirst && <TeamFlag flag={team.flag} name={team.name} size={28} />}
        <span className="text-sm font-semibold text-white">{team.name}</span>
        {!flagFirst && <TeamFlag flag={team.flag} name={team.name} size={28} />}
      </div>
    );
  };

  const renderMatch = (match: Match) => {
    const locked = isLocked(match);
    const pred = predMap.get(match.id);
    const scoreState = scores[match.id];
    const mSaveStatus = matchSaveStatus[match.id] ?? "idle";

    const { home: projectedHome, away: projectedAway } = getDisplayTeams(match);
    const displayHome = match.homeTeam ?? projectedHome;
    const displayAway = match.awayTeam ?? projectedAway;
    const homeLabel = getSlotLabel(match.matchNumber, "home");
    const awayLabel = getSlotLabel(match.matchNumber, "away");

    const hasActualResult = match.status === "finished" && match.homeScore !== null && match.awayScore !== null;
    const isLive = match.status === "live";

    const kickoffDate = new Date(match.kickoff);
    const timeStr = kickoffDate.toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });

    const tied = !locked && isTied(match.id);
    const needsPenalty = tied && !penaltyWinners[match.id];

    return (
      <div
        key={match.id}
        className={`bg-gray-900 border rounded-xl p-4 flex flex-col gap-3 ${
          hasActualResult ? "border-gray-700" : needsPenalty ? "border-amber-500/50" : "border-gray-800"
        }`}
      >
        {/* Match header */}
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>#{match.matchNumber} · {timeStr}</span>
          <div className="flex items-center gap-2">
            {isLive && (
              <span className="text-xs bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded">LIVE</span>
            )}
            {hasActualResult && (
              <span className="text-xs bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded">FT</span>
            )}
            {mSaveStatus === "saving" && (
              <span className="text-xs text-gray-500">saving…</span>
            )}
            {mSaveStatus === "saved" && (
              <span className="text-xs text-green-400">✓</span>
            )}
            {mSaveStatus === "error" && (
              <span className="text-xs text-red-400">error</span>
            )}
          </div>
        </div>

        {/* Actual result row */}
        {(hasActualResult || isLive) && (
          <div className="flex items-center gap-3 w-full">
            {renderTeamSlot(displayHome, "home", homeLabel)}
            <div className="flex items-center gap-2">
              <div className={`w-10 h-10 flex items-center justify-center rounded-lg font-bold text-lg ${
                isLive ? "bg-green-900/40 text-green-300" : "bg-gray-800 text-white"
              }`}>
                {match.homeScore ?? "—"}
              </div>
              <span className="text-gray-400 font-bold">-</span>
              <div className={`w-10 h-10 flex items-center justify-center rounded-lg font-bold text-lg ${
                isLive ? "bg-green-900/40 text-green-300" : "bg-gray-800 text-white"
              }`}>
                {match.awayScore ?? "—"}
              </div>
            </div>
            {renderTeamSlot(displayAway, "away", awayLabel)}
          </div>
        )}

        {/* User prediction row */}
        <div className="flex items-center gap-3 w-full">
          {!hasActualResult && !isLive && renderTeamSlot(displayHome, "home", homeLabel)}

          {hasActualResult || isLive ? (
            <div className="flex-1 flex items-center justify-center gap-2">
              <span className="text-xs text-gray-500 mr-1">Your pick:</span>
              <div className="w-8 h-8 flex items-center justify-center bg-gray-800 rounded text-sm font-bold text-gray-300">
                {pred ? String(pred.homeScore) : "—"}
              </div>
              <span className="text-gray-500 text-sm">-</span>
              <div className="w-8 h-8 flex items-center justify-center bg-gray-800 rounded text-sm font-bold text-gray-300">
                {pred ? String(pred.awayScore) : "—"}
              </div>
              {pred?.penaltyWinner && (
                <span className="text-xs text-gray-400 ml-1">
                  ({pred.penaltyWinner === "home" ? displayHome?.name ?? "Home" : displayAway?.name ?? "Away"} on pens)
                </span>
              )}
              {pred?.earnedAmount != null && (
                <div className={`ml-2 inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full ${
                  pred.earnedAmount > 0 ? "bg-amber-400/20 text-amber-400" : "bg-gray-700 text-gray-400"
                }`}>
                  €{pred.earnedAmount.toFixed(2)}
                </div>
              )}
              {!pred && (
                <span className="text-xs text-gray-600 italic ml-1">No prediction</span>
              )}
            </div>
          ) : locked ? (
            <>
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 flex items-center justify-center bg-gray-800 rounded-lg text-white font-bold text-lg">
                  {scoreState?.home ?? (pred ? String(pred.homeScore) : "—")}
                </div>
                <span className="text-gray-400 font-bold">-</span>
                <div className="w-10 h-10 flex items-center justify-center bg-gray-800 rounded-lg text-white font-bold text-lg">
                  {scoreState?.away ?? (pred ? String(pred.awayScore) : "—")}
                </div>
              </div>
              {pred?.penaltyWinner && (
                <span className="text-xs text-gray-400 ml-1">
                  ({pred.penaltyWinner === "home" ? displayHome?.name ?? "Home" : displayAway?.name ?? "Away"} on pens)
                </span>
              )}
              {pred?.earnedAmount != null && (
                <div className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full ${
                  pred.earnedAmount > 0 ? "bg-amber-400/20 text-amber-400" : "bg-gray-700 text-gray-400"
                }`}>
                  €{pred.earnedAmount.toFixed(2)}
                </div>
              )}
              {!pred && <span className="text-xs text-gray-600 italic">No prediction</span>}
            </>
          ) : (
            <div className="flex items-center gap-2">
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
            </div>
          )}

          {!hasActualResult && !isLive && renderTeamSlot(displayAway, "away", awayLabel)}
        </div>

        {/* Penalty shootout selector — appears when score is tied */}
        {!locked && tied && (
          <div className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
            <span className="text-xs text-amber-400 shrink-0">Penalty winner:</span>
            <div className="flex gap-2 flex-1">
              <button
                onClick={() => handlePenaltyChange(match.id, "home")}
                className={`flex-1 text-xs font-semibold px-2 py-1 rounded-lg transition-colors ${
                  penaltyWinners[match.id] === "home"
                    ? "bg-amber-400 text-gray-900"
                    : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                }`}
              >
                {displayHome?.name ?? "Home"}
              </button>
              <button
                onClick={() => handlePenaltyChange(match.id, "away")}
                className={`flex-1 text-xs font-semibold px-2 py-1 rounded-lg transition-colors ${
                  penaltyWinners[match.id] === "away"
                    ? "bg-amber-400 text-gray-900"
                    : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                }`}
              >
                {displayAway?.name ?? "Away"}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const allPredictions = predictions.map((p) => p.match);
  const filledCount = allPredictions.filter((m) => {
    const s = scores[m.id];
    if (!s || s.home === "" || s.away === "") return false;
    const h = parseInt(s.home, 10);
    const a = parseInt(s.away, 10);
    if (isNaN(h) || isNaN(a)) return false;
    if (h === a && !penaltyWinners[m.id]) return false;
    return true;
  }).length;

  return (
    <div>
      {allKOLocked && roomStatus && roomStatus !== "ko_betting" && availableRounds.length > 0 && (
        <div className="mb-4 flex items-center gap-2 text-sm text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-xl px-4 py-3">
          <span>🔒</span>
          {roomStatus === "ko_active" || roomStatus === "settling" || roomStatus === "finished"
            ? <span>KO predictions are locked — bracket is now playing out.</span>
            : simulationMode
            ? <span>Run Phase 1 simulation first to open the KO prediction window.</span>
            : <span>KO predictions open during the &quot;KO Betting&quot; window between group stage and first KO match.</span>
          }
        </div>
      )}

      {/* Global save bar */}
      {!allKOLocked && (
        <div className="flex items-center justify-between mb-4 bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-400">
              {filledCount}/{allPredictions.length} predictions filled
              <span className="ml-2 text-xs text-gray-600">(auto-saves as you type)</span>
            </span>
            <button
              onClick={handlePickForMe}
              disabled={globalSaving}
              title="Randomly fill all knockout predictions — handy when you're stuck or just want to get on with it"
              className="text-sm text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 border border-gray-700 px-3 py-1 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              🎲 Pick for me
            </button>
          </div>
          <button
            onClick={handleSaveAll}
            disabled={globalSaving || filledCount === 0}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              globalStatus === "saved"
                ? "bg-green-500 text-white"
                : globalStatus === "error"
                ? "bg-red-500 text-white"
                : "bg-amber-400 hover:bg-amber-300 text-gray-900"
            }`}
          >
            {globalStatus === "saved" ? "Saved!" : globalStatus === "error" ? "Error — retry" : globalSaving ? "Saving…" : `Save all`}
          </button>
        </div>
      )}

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
          roundMatches.map(renderMatch)
        )}
      </div>
    </div>
  );
}
