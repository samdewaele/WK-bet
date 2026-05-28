"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { TestTournamentReport } from "@/lib/test-tournament";

type Settings = { name: string; entryFee: string; status: string };
type TestState =
  | { phase: "checking" }
  | { phase: "idle" }
  | { phase: "running" }
  | { phase: "seeded"; report: TestTournamentReport }
  | { phase: "cleaning" };

const STATUS_OPTIONS = ["setup", "open", "locked", "active", "finished"];
const STATUS_COLORS: Record<string, string> = {
  setup:    "text-gray-400",
  open:     "text-green-400",
  locked:   "text-yellow-400",
  active:   "text-blue-400",
  finished: "text-purple-400",
};

export default function GroupAdminPanel({
  roomId,
  initialName,
  initialFee,
  initialStatus,
  isPlatformAdmin,
}: {
  roomId: string;
  initialName: string;
  initialFee: number;
  initialStatus: string;
  isPlatformAdmin: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<Settings>({
    name: initialName,
    entryFee: initialFee.toFixed(2),
    status: initialStatus,
  });
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [testState, setTestState] = useState<TestState>({ phase: "checking" });
  const [testError, setTestError] = useState("");

  // Check if test players are already seeded when panel opens
  useEffect(() => {
    if (!open) return;
    setTestState({ phase: "checking" });
    fetch(`/api/admin/groups/${roomId}/test`)
      .then((r) => r.json())
      .then((data) => {
        if (data.seeded) setTestState({ phase: "seeded", report: data.report });
        else setTestState({ phase: "idle" });
      })
      .catch(() => setTestState({ phase: "idle" }));
  }, [open, roomId]);

  async function handleSave() {
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await fetch(`/api/admin/groups/${roomId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: settings.name,
          entryFee: parseFloat(settings.entryFee) || 0,
          status: settings.status,
        }),
      });
      if (res.ok) {
        setSaveMsg("Saved");
        router.refresh();
      } else {
        const d = await res.json();
        setSaveMsg(d.error ?? "Save failed");
      }
    } catch {
      setSaveMsg("Network error");
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(""), 3000);
    }
  }

  async function handleSeed() {
    setTestError("");
    setTestState({ phase: "running" });
    try {
      const res = await fetch(`/api/admin/groups/${roomId}/test`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) { setTestError(data.error ?? "Failed"); setTestState({ phase: "idle" }); return; }
      setTestState({ phase: "seeded", report: data.report });
      router.refresh();
    } catch {
      setTestError("Network error");
      setTestState({ phase: "idle" });
    }
  }

  async function handleCleanup() {
    setTestError("");
    setTestState({ phase: "cleaning" });
    try {
      await fetch(`/api/admin/groups/${roomId}/test`, { method: "DELETE" });
      setTestState({ phase: "idle" });
      router.refresh();
    } catch {
      setTestError("Cleanup failed");
      setTestState({ phase: "idle" });
    }
  }

  return (
    <div>
      {/* Toggle button — sits in the group header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
          open
            ? "bg-violet-600 text-white"
            : "bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white"
        }`}
      >
        <span className="text-sm">⚙</span>
        Admin
      </button>

      {/* Collapsible panel */}
      {open && (
        <div className="mt-4 bg-gray-900/80 border border-violet-500/30 rounded-xl p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left: Settings */}
          <div>
            <h3 className="text-sm font-bold text-violet-400 uppercase tracking-wide mb-3">
              Group Settings
            </h3>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Name</label>
                <input
                  type="text"
                  value={settings.name}
                  onChange={(e) => setSettings((s) => ({ ...s, name: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Entry fee (€)</label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={settings.entryFee}
                  onChange={(e) => setSettings((s) => ({ ...s, entryFee: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Status</label>
                <div className="flex flex-wrap gap-2">
                  {STATUS_OPTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => setSettings((prev) => ({ ...prev, status: s }))}
                      className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors capitalize ${
                        settings.status === s
                          ? "border-violet-500 bg-violet-500/20 text-violet-300"
                          : "border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-500"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-600 mt-1">
                  Current: <span className={STATUS_COLORS[settings.status] ?? "text-gray-400"}>{settings.status}</span>
                </p>
              </div>

              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-colors"
                >
                  {saving ? "Saving…" : "Save changes"}
                </button>
                {saveMsg && (
                  <span className={saveMsg === "Saved" ? "text-green-400 text-sm" : "text-red-400 text-sm"}>
                    {saveMsg}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right: Test simulation — platform admin only */}
          {isPlatformAdmin && <div>
            <h3 className="text-sm font-bold text-violet-400 uppercase tracking-wide mb-3">
              Test Simulation
            </h3>
            <p className="text-xs text-gray-400 mb-3">
              Adds 5 fake players with varied prediction quality to this group, simulates
              3 Group A results and scores their predictions. Browse all tabs to verify
              the UI. Remove test players when done.
            </p>

            {testError && <p className="text-xs text-red-400 mb-2">{testError}</p>}

            <div className="flex gap-2 mb-3">
              {(testState.phase === "idle" || testState.phase === "checking") && (
                <button
                  onClick={handleSeed}
                  disabled={testState.phase === "checking"}
                  className="inline-flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white font-semibold px-3 py-2 rounded-lg text-xs transition-colors"
                >
                  {testState.phase === "checking" ? "Checking…" : "▶ Seed & Simulate"}
                </button>
              )}

              {testState.phase === "running" && (
                <button disabled className="inline-flex items-center gap-1.5 bg-emerald-700 opacity-50 text-white font-semibold px-3 py-2 rounded-lg text-xs">
                  <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Running…
                </button>
              )}

              {testState.phase === "seeded" && (
                <>
                  <span className="text-xs text-emerald-400 self-center">✓ Test players active</span>
                  <button
                    onClick={handleCleanup}
                    className="ml-auto inline-flex items-center gap-1 bg-red-800 hover:bg-red-700 text-white font-semibold px-3 py-2 rounded-lg text-xs transition-colors"
                  >
                    🗑 Cleanup
                  </button>
                </>
              )}

              {testState.phase === "cleaning" && (
                <button disabled className="inline-flex items-center gap-1.5 bg-red-800 opacity-50 text-white font-semibold px-3 py-2 rounded-lg text-xs">
                  <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Cleaning…
                </button>
              )}
            </div>

            {testState.phase === "seeded" && (
              <div className="space-y-2">
                {/* Mini match results */}
                <div className="flex flex-wrap gap-2 mb-2">
                  {testState.report.matches.map((m, i) => (
                    <span key={i} className="bg-gray-800 rounded px-2 py-1 text-xs text-gray-300">
                      {m.homeTeam} <span className="text-amber-400 font-bold">{m.score}</span> {m.awayTeam}
                    </span>
                  ))}
                </div>

                {/* Mini leaderboard */}
                <div className="rounded-lg border border-gray-700 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-700 text-gray-500">
                        <th className="text-left px-2 py-1.5">#</th>
                        <th className="text-left px-2 py-1.5">Player</th>
                        <th className="text-right px-2 py-1.5">Pts</th>
                        <th className="text-right px-2 py-1.5">Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const total = testState.report.leaderboard.reduce((s, p) => s + p.points, 0);
                        return testState.report.leaderboard.map((p, i) => {
                          const share = total > 0 ? (p.points / total) * testState.report.potTotal : 0;
                          return (
                            <tr key={i} className="border-b border-gray-800 last:border-0">
                              <td className="px-2 py-1.5 text-gray-600">{i + 1}</td>
                              <td className="px-2 py-1.5 text-white">{p.name}</td>
                              <td className="px-2 py-1.5 text-right text-amber-400 font-bold">{p.points}</td>
                              <td className="px-2 py-1.5 text-right text-green-400">€{share.toFixed(2)}</td>
                            </tr>
                          );
                        });
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>}
        </div>
      )}
    </div>
  );
}
