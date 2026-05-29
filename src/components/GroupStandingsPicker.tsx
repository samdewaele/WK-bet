"use client";

import { useState, useEffect, useCallback } from "react";
import TeamFlag from "@/components/TeamFlag";

const WC_GROUPS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];

type Team = {
  id: string;
  name: string;
  flag: string;
  group: string;
};

type Prediction = {
  wcGroup: string;
  position1: string;
  position2: string;
  position3: string;
  position4: string;
  earnedAmount: number | null;
};

type Props = {
  roomId: string;
};

type GroupState = {
  position1: string;
  position2: string;
  position3: string;
  position4: string;
};

export default function GroupStandingsPicker({ roomId }: Props) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [groupStates, setGroupStates] = useState<Record<string, GroupState>>({});
  const [savedStates, setSavedStates] = useState<Record<string, GroupState>>({});
  const [lockedGroups, setLockedGroups] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ count: number; error?: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [teamsRes, predsRes, matchesRes] = await Promise.all([
          fetch("/api/teams"),
          fetch(`/api/groups/${roomId}/standings`),
          fetch("/api/matches"),
        ]);

        const teamsData: Team[] = teamsRes.ok ? await teamsRes.json() : [];
        const predsData: Prediction[] = predsRes.ok ? await predsRes.json() : [];
        const matchesData: { group: string | null; kickoff: string }[] = matchesRes.ok
          ? await matchesRes.json()
          : [];

        setTeams(teamsData);
        setPredictions(predsData);

        const initialStates: Record<string, GroupState> = {};
        for (const p of predsData) {
          initialStates[p.wcGroup] = {
            position1: p.position1,
            position2: p.position2,
            position3: p.position3,
            position4: p.position4,
          };
        }
        setGroupStates(initialStates);
        setSavedStates(initialStates);

        const now = new Date();
        const locked = new Set<string>();
        for (const m of matchesData) {
          if (m.group && new Date(m.kickoff) <= now) {
            locked.add(m.group);
          }
        }
        setLockedGroups(locked);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [roomId]);

  const teamsByGroup = (group: string) => teams.filter((t) => t.group === group);

  const handleChange = (group: string, pos: keyof GroupState, teamId: string) => {
    setGroupStates((prev) => {
      const current = prev[group] ?? { position1: "", position2: "", position3: "", position4: "" };
      const updated = { ...current, [pos]: teamId };
      const positions: (keyof GroupState)[] = ["position1", "position2", "position3", "position4"];
      for (const otherPos of positions) {
        if (otherPos !== pos && updated[otherPos] === teamId && teamId !== "") {
          updated[otherPos] = "";
        }
      }
      return { ...prev, [group]: updated };
    });
  };

  const isComplete = (state: GroupState) =>
    state.position1 && state.position2 && state.position3 && state.position4;

  const hasUnsaved = WC_GROUPS.some((group) => {
    if (lockedGroups.has(group)) return false;
    const cur = groupStates[group];
    const saved = savedStates[group];
    if (!cur) return false;
    if (!isComplete(cur)) return false;
    if (!saved) return true;
    return (
      cur.position1 !== saved.position1 ||
      cur.position2 !== saved.position2 ||
      cur.position3 !== saved.position3 ||
      cur.position4 !== saved.position4
    );
  });

  const handleSaveAll = useCallback(async () => {
    const toSave = WC_GROUPS.filter((group) => {
      if (lockedGroups.has(group)) return false;
      const cur = groupStates[group];
      return cur && isComplete(cur);
    });

    if (toSave.length === 0) return;

    setSaving(true);
    setSaveResult(null);
    try {
      const res = await fetch(`/api/groups/${roomId}/standings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          predictions: toSave.map((group) => ({
            wcGroup: group,
            ...groupStates[group],
          })),
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const locked = errData.error?.toLowerCase().includes("locked");
        setSaveResult({
          count: 0,
          error: locked ? "Predictions are closed for this group 🔒" : (errData.error ?? "Save failed — try again"),
        });
        setTimeout(() => setSaveResult(null), 5000);
        return;
      }

      const saved: Record<string, GroupState> = { ...savedStates };
      for (const group of toSave) saved[group] = groupStates[group];
      setSavedStates(saved);
      setSaveResult({ count: toSave.length });
      setTimeout(() => setSaveResult(null), 3000);
    } catch {
      setSaveResult({ count: 0, error: "Network error — try again" });
      setTimeout(() => setSaveResult(null), 3000);
    } finally {
      setSaving(false);
    }
  }, [roomId, groupStates, savedStates, lockedGroups]);

  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {WC_GROUPS.map((g) => (
          <div key={g} className="bg-gray-900 border border-gray-800 rounded-xl p-4 animate-pulse h-48" />
        ))}
      </div>
    );
  }

  const unlockedComplete = WC_GROUPS.filter((g) => !lockedGroups.has(g) && isComplete(groupStates[g] ?? { position1: "", position2: "", position3: "", position4: "" })).length;
  const unlockedTotal = WC_GROUPS.filter((g) => !lockedGroups.has(g)).length;

  return (
    <div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mb-6">
        {WC_GROUPS.map((group) => {
          const groupTeams = teamsByGroup(group);
          const state = groupStates[group] ?? { position1: "", position2: "", position3: "", position4: "" };
          const isLocked = lockedGroups.has(group);
          const existingPred = predictions.find((p) => p.wcGroup === group);
          const complete = isComplete(state);
          const saved = savedStates[group];
          const isDirty = complete && (!saved || Object.keys(state).some(k => state[k as keyof GroupState] !== saved[k as keyof GroupState]));

          return (
            <div
              key={group}
              className={`bg-gray-900 border rounded-xl p-4 ${
                isLocked ? "border-gray-700 opacity-75" : isDirty ? "border-amber-400/40" : "border-gray-800"
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-amber-400">Group {group}</h3>
                <div className="flex items-center gap-2">
                  {isLocked && (
                    <span className="text-xs bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full">
                      Locked
                    </span>
                  )}
                  {!isLocked && isDirty && (
                    <span className="text-xs bg-amber-400/20 text-amber-400 px-2 py-0.5 rounded-full">
                      Unsaved
                    </span>
                  )}
                  {existingPred?.earnedAmount != null && (
                    <span className="text-xs text-green-400 font-bold">
                      +€{existingPred.earnedAmount.toFixed(2)}
                    </span>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                {(["position1", "position2", "position3", "position4"] as const).map((pos, idx) => {
                  const selected = state[pos];
                  const selectedTeam = teams.find((t) => t.id === selected);

                  return (
                    <div key={pos} className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 w-5 text-right">{idx + 1}.</span>
                      {isLocked ? (
                        <div className="flex-1 bg-gray-800 rounded-lg px-3 py-1.5 text-sm text-gray-300 flex items-center gap-2">
                          {selectedTeam ? (
                            <>
                              <TeamFlag flag={selectedTeam.flag} name={selectedTeam.name} size={20} />
                              <span>{selectedTeam.name}</span>
                            </>
                          ) : (
                            <span className="text-gray-600 italic">Not predicted</span>
                          )}
                        </div>
                      ) : (
                        <select
                          value={selected}
                          onChange={(e) => handleChange(group, pos, e.target.value)}
                          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-amber-400"
                        >
                          <option value="">— Pick team —</option>
                          {groupTeams.map((team) => (
                            <option
                              key={team.id}
                              value={team.id}
                              disabled={
                                team.id !== selected &&
                                (state.position1 === team.id ||
                                  state.position2 === team.id ||
                                  state.position3 === team.id ||
                                  state.position4 === team.id)
                              }
                            >
                              {team.flag} {team.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Single save button */}
      {unlockedTotal > 0 && (
        <div className="flex items-center justify-between gap-4 py-4 border-t border-gray-800">
          <span className="text-sm text-gray-500">
            {unlockedComplete}/{unlockedTotal} groups filled in
          </span>
          <div className="flex items-center gap-3">
            {saveResult && (
              <span className={`text-sm ${saveResult.error ? "text-red-400" : "text-green-400"}`}>
                {saveResult.error ?? `✓ ${saveResult.count} group${saveResult.count !== 1 ? "s" : ""} saved`}
              </span>
            )}
            <button
              onClick={handleSaveAll}
              disabled={saving || !hasUnsaved}
              className="bg-amber-400 hover:bg-amber-300 disabled:opacity-40 disabled:cursor-not-allowed text-gray-900 font-semibold px-6 py-2.5 rounded-xl text-sm transition-colors"
            >
              {saving ? "Saving…" : "Save all predictions"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
