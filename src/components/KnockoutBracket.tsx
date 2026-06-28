"use client";

import { useMemo } from "react";
import TeamFlag from "@/components/TeamFlag";
import type { Match, Prediction, Team } from "@/components/KnockoutPredictions";
import {
  computeBracketLayout,
  computeConnectors,
  formatKickoff,
  R32_SOURCE_LABELS,
  BRACKET_LAYOUT,
  type PositionedTile,
} from "@/lib/ko-bracket";
import { koScheduledKickoff } from "@/lib/ko-schedule";

type ScoreState = Record<string, { home: string; away: string }>;
type SaveStatus = "idle" | "saving" | "saved" | "error";

type Props = {
  predictions: Prediction[];
  scores: ScoreState;
  penaltyWinners: Record<string, "home" | "away">;
  matchSaveStatus: Record<string, SaveStatus>;
  getDisplayTeams: (match: Match) => { home: Team | null; away: Team | null };
  isLocked: (match: Match) => boolean;
  isTied: (matchId: string) => boolean;
  onScoreChange: (matchId: string, side: "home" | "away", value: string) => void;
  onPenaltyChange: (matchId: string, winner: "home" | "away") => void;
};

const HEADER_H = 34;

export default function KnockoutBracket({
  predictions,
  scores,
  penaltyWinners,
  matchSaveStatus,
  getDisplayTeams,
  isLocked,
  isTied,
  onScoreChange,
  onPenaltyChange,
}: Props) {
  const layout = useMemo(() => computeBracketLayout(), []);
  const connectors = useMemo(() => computeConnectors(), []);

  // matchNumber → prediction (carries teams, scores, status, earnings)
  const predByNumber = useMemo(() => {
    const m = new Map<number, Prediction>();
    for (const p of predictions) m.set(p.match.matchNumber, p);
    return m;
  }, [predictions]);

  if (predictions.length === 0) {
    return (
      <div className="rounded-2xl border border-emerald-900/40 bg-[#06140d] p-10 text-center text-gray-500">
        Bracket loads once the knockout matches are drawn.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-emerald-900/50 bg-gradient-to-b from-[#0a1f14] to-[#06140d] p-3 shadow-[inset_0_0_60px_rgba(16,185,129,0.06)]">
      <div
        className="relative"
        style={{ width: layout.width, height: layout.height + HEADER_H }}
      >
        {/* Round header strip */}
        {layout.columns.map((c) => {
          const isFinal = c.label === "FINAL";
          return (
            <div
              key={c.col}
              className={`absolute text-center text-[11px] font-extrabold uppercase tracking-[0.15em] ${
                isFinal ? "text-amber-300" : "text-emerald-400/70"
              }`}
              style={{ left: c.x, top: 0, width: BRACKET_LAYOUT.TILE_W }}
            >
              {c.label}
            </div>
          );
        })}

        {/* Connector lines (gold "path to glory") */}
        <svg
          className="pointer-events-none absolute"
          style={{ left: 0, top: HEADER_H }}
          width={layout.width}
          height={layout.height}
          aria-hidden="true"
        >
          {connectors.map((c, i) => (
            <polyline
              key={i}
              points={c.points.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke="rgba(251,191,36,0.28)"
              strokeWidth={1.5}
            />
          ))}
        </svg>

        {/* Match tiles */}
        <div className="absolute" style={{ left: 0, top: HEADER_H, width: layout.width, height: layout.height }}>
          {layout.tiles.map((tile) => (
            <BracketTile
              key={tile.matchNumber}
              tile={tile}
              prediction={predByNumber.get(tile.matchNumber)}
              scores={scores}
              penaltyWinners={penaltyWinners}
              saveStatus={matchSaveStatus}
              getDisplayTeams={getDisplayTeams}
              isLocked={isLocked}
              isTied={isTied}
              onScoreChange={onScoreChange}
              onPenaltyChange={onPenaltyChange}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function BracketTile({
  tile,
  prediction,
  scores,
  penaltyWinners,
  saveStatus,
  getDisplayTeams,
  isLocked,
  isTied,
  onScoreChange,
  onPenaltyChange,
}: {
  tile: PositionedTile;
  prediction?: Prediction;
  scores: ScoreState;
  penaltyWinners: Record<string, "home" | "away">;
  saveStatus: Record<string, SaveStatus>;
  getDisplayTeams: (match: Match) => { home: Team | null; away: Team | null };
  isLocked: (match: Match) => boolean;
  isTied: (matchId: string) => boolean;
  onScoreChange: (matchId: string, side: "home" | "away", value: string) => void;
  onPenaltyChange: (matchId: string, winner: "home" | "away") => void;
}) {
  const isFinal = tile.round === "Final";
  const isThird = tile.round === "3rd";

  const frame = isFinal
    ? "border-amber-400/70 bg-gradient-to-b from-amber-500/15 to-[#0a1f14] shadow-[0_0_18px_rgba(251,191,36,0.25)]"
    : isThird
    ? "border-orange-700/50 bg-gradient-to-b from-orange-900/20 to-[#0a1f14]"
    : "border-emerald-800/50 bg-[#0b2417]/80";

  // Empty slot (match not seeded yet)
  if (!prediction) {
    return (
      <div
        className={`absolute rounded-lg border ${frame} flex items-center justify-center text-[10px] text-gray-600`}
        style={{ left: tile.x, top: tile.y, width: tile.width, height: tile.height }}
      >
        {isFinal ? "🏆 Final" : isThird ? "🥉 3rd place" : `#${tile.matchNumber}`}
      </div>
    );
  }

  const match = prediction.match;
  const { home: displayHome, away: displayAway } = getDisplayTeams(match);
  const homeLabel = R32_SOURCE_LABELS[tile.matchNumber]?.home;
  const awayLabel = R32_SOURCE_LABELS[tile.matchNumber]?.away;

  const locked = isLocked(match);
  const finished = match.status === "finished" && match.homeScore != null && match.awayScore != null;
  const live = match.status === "live";
  const editable = !locked;

  const scoreState = scores[match.id];
  const homeVal = scoreState?.home ?? (prediction.predicted ? String(prediction.homeScore) : "");
  const awayVal = scoreState?.away ?? (prediction.predicted ? String(prediction.awayScore) : "");
  const status = saveStatus[match.id] ?? "idle";
  const tied = editable && isTied(match.id);

  // Which side did the user pick to win? (for the gold winner highlight)
  const pickedWinner: "home" | "away" | null = (() => {
    const h = parseInt(homeVal, 10);
    const a = parseInt(awayVal, 10);
    if (Number.isNaN(h) || Number.isNaN(a)) return null;
    if (h > a) return "home";
    if (a > h) return "away";
    return penaltyWinners[match.id] ?? prediction.penaltyWinner ?? null;
  })();

  const teamRow = (
    side: "home" | "away",
    team: Team | null,
    label: string | undefined,
    value: string,
  ) => {
    const won = pickedWinner === side;
    return (
      <div
        className={`flex items-center gap-1 px-1.5 ${won ? "bg-amber-400/10" : ""}`}
        style={{ height: (tile.height - 2) / 2 }}
      >
        {team ? (
          <TeamFlag flag={team.flag} name={team.name} size={14} />
        ) : (
          <span className="inline-block h-[14px] w-[14px] shrink-0 rounded-sm bg-emerald-900/60" />
        )}
        <span className={`flex-1 truncate text-[11px] ${won ? "font-bold text-amber-200" : "text-gray-200"}`}>
          {team?.name ?? label ?? "TBD"}
        </span>
        {editable ? (
          <input
            type="number"
            min={0}
            max={20}
            value={value}
            onChange={(e) => onScoreChange(match.id, side, e.target.value)}
            className="h-5 w-7 shrink-0 rounded bg-[#06140d] text-center text-[12px] font-bold text-white outline-none ring-1 ring-emerald-800/70 focus:ring-amber-400 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            placeholder="·"
          />
        ) : (
          <span className="h-5 w-7 shrink-0 rounded bg-[#06140d] text-center text-[12px] font-bold leading-5 text-white">
            {value === "" ? "·" : value}
          </span>
        )}
      </div>
    );
  };

  return (
    <>
      <div
        className={`absolute overflow-hidden rounded-lg border ${frame} ${
          tied ? "ring-1 ring-amber-500/60" : ""
        }`}
        style={{ left: tile.x, top: tile.y, width: tile.width, height: tile.height }}
      >
        {/* tiny header line: match # + status / save indicator */}
        <div className="flex items-center justify-between gap-1 px-1.5 pt-[1px] text-[8px] leading-none text-emerald-500/60">
          <span className="shrink-0">
            {isFinal ? "🏆 FINAL" : isThird ? "🥉 3RD" : `#${tile.matchNumber}`}
            <span className="ml-1 font-normal text-emerald-400/45">
              {formatKickoff(koScheduledKickoff(tile.matchNumber) ?? match.kickoff)}
            </span>
          </span>
          <span>
            {live && <span className="text-green-400">● LIVE</span>}
            {finished && <span className="text-gray-400">FT {match.homeScore}–{match.awayScore}</span>}
            {!finished && !live && status === "saving" && <span className="text-gray-400">…</span>}
            {!finished && !live && status === "saved" && <span className="text-green-400">✓</span>}
            {!finished && !live && status === "error" && <span className="text-red-400">!</span>}
            {prediction.earnedAmount != null && prediction.earnedAmount > 0 && (
              <span className="ml-1 text-amber-300">+€{prediction.earnedAmount.toFixed(0)}</span>
            )}
          </span>
        </div>
        {teamRow("home", displayHome, homeLabel, homeVal)}
        {teamRow("away", displayAway, awayLabel, awayVal)}
      </div>

      {/* Penalty-winner selector — floats just under a tied, editable tile */}
      {tied && (
        <div
          className="absolute z-20 flex items-center gap-1 rounded-lg border border-amber-500/40 bg-[#0b2417] px-2 py-1 shadow-lg"
          style={{ left: tile.x, top: tile.y + tile.height + 4, width: Math.max(tile.width, 150) }}
        >
          <span className="shrink-0 text-[9px] text-amber-400">Penalty winner:</span>
          <button
            onClick={() => onPenaltyChange(match.id, "home")}
            className={`flex-1 truncate rounded px-1 py-0.5 text-[9px] font-semibold transition-colors ${
              penaltyWinners[match.id] === "home"
                ? "bg-amber-400 text-gray-900"
                : "bg-gray-700 text-gray-200 hover:bg-gray-600"
            }`}
          >
            {displayHome?.name ?? "Home"}
          </button>
          <button
            onClick={() => onPenaltyChange(match.id, "away")}
            className={`flex-1 truncate rounded px-1 py-0.5 text-[9px] font-semibold transition-colors ${
              penaltyWinners[match.id] === "away"
                ? "bg-amber-400 text-gray-900"
                : "bg-gray-700 text-gray-200 hover:bg-gray-600"
            }`}
          >
            {displayAway?.name ?? "Away"}
          </button>
        </div>
      )}
    </>
  );
}
