"use client";

import { useState, useEffect } from "react";

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

type SaveStatus = "idle" | "saving" | "saved" | "error";

export default function GroupStandingsPicker({ roomId }: Props) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [groupStates, setGroupStates] = useState<Record<string, GroupState>>({});
  const [lockedGroups, setLockedGroups] = useState<Set<string>>(new Set());
  const [saveStatus, setSaveStatus] = useState<Record<string, SaveStatus>>({});
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

  const handleSave = async (group: string) => {
    const state = groupStates[group];
    if (!state || !state.position1 || !state.position2 || !state.position3 || !state.position4) {
      return;
    }

    setSaveStatus((prev) => ({ ...prev, [group]: "saving" }));
    try {
      const res = await fetch(`/api/groups/${roomId}/standings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          predictions: [
            {
              wcGroup: group,
              position1: state.position1,
              position2: state.position2,
              position3: state.position3,
              position4: state.position4,
            },
          ],
        }),
      });

      if (!res.ok) throw new Error("Failed");
      setSaveStatus((prev) => ({ ...prev, [group]: "saved" }));
      setTimeout(() => setSaveStatus((prev) => ({ ...prev, [group]: "idle" })), 3000);
    } catch {
      setSaveStatus((prev) => ({ ...prev, [group]: "error" }));
      setTimeout(() => setSaveStatus((prev) => ({ ...prev, [group]: "idle" })), 3000);
    }
  };

  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {WC_GROUPS.map((g) => (
          <div key={g} className="bg-gray-900 border border-gray-800 rounded-xl p-4 animate-pulse h-48" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {WC_GROUPS.map((group) => {
        const groupTeams = teamsByGroup(group);
        const state = groupStates[group] ?? { position1: "", position2: "", position3: "", position4: "" };
        const isLocked = lockedGroups.has(group);
        const status = saveStatus[group] ?? "idle";
        const existingPred = predictions.find((p) => p.wcGroup === group);
        const isComplete = state.position1 && state.position2 && state.position3 && state.position4;

        return (
          <div
            key={group}
            className={`bg-gray-900 border rounded-xl p-4 ${
              isLocked ? "border-gray-700 opacity-75" : "border-gray-800"
            }`}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-amber-400">Group {group}</h3>
              {isLocked && (
                <span className="text-xs bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full">
                  Locked
                </span>
              )}
              {existingPred?.earnedAmount != null && (
                <span className="text-xs text-green-400 font-bold">
                  +€{existingPred.earnedAmount.toFixed(2)}
                </span>
              )}
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
                            <span>{selectedTeam.flag}</span>
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

            {!isLocked && (
              <button
                onClick={() => handleSave(group)}
                disabled={!isComplete || status === "saving"}
                className={`mt-3 w-full py-1.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  status === "saved"
                    ? "bg-green-500 text-white"
                    : status === "error"
                    ? "bg-red-500 text-white"
                    : "bg-amber-400 hover:bg-amber-300 text-gray-900"
                }`}
              >
                {status === "saving"
                  ? "Saving..."
                  : status === "saved"
                  ? "Saved!"
                  : status === "error"
                  ? "Error — retry"
                  : "Save"}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
