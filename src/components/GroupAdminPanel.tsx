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

type Member = { userId: string; name: string | null };

const STATUS_OPTIONS = ["setup", "open", "locked", "active", "finished"];
const STATUS_COLORS: Record<string, string> = {
  setup: "text-gray-400", open: "text-green-400", locked: "text-yellow-400",
  active: "text-blue-400", finished: "text-purple-400",
};

export default function GroupAdminPanel({
  roomId,
  initialName,
  initialFee,
  initialStatus,
  initialCreatorId,
  isPlatformAdmin,
  members,
}: {
  roomId: string;
  initialName: string;
  initialFee: number;
  initialStatus: string;
  initialCreatorId: string | null;
  isPlatformAdmin: boolean;
  members: Member[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // Settings
  const [settings, setSettings] = useState<Settings>({
    name: initialName, entryFee: initialFee.toFixed(2), status: initialStatus,
  });
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  // Transfer
  const [transferTarget, setTransferTarget] = useState("");
  const [transferring, setTransferring] = useState(false);
  const [transferMsg, setTransferMsg] = useState("");

  // Disband
  const [disbanding, setDisbanding] = useState(false);

  // Test simulation
  const [testState, setTestState] = useState<TestState>({ phase: "checking" });
  const [testError, setTestError] = useState("");

  useEffect(() => {
    if (!open || !isPlatformAdmin) return;
    setTestState({ phase: "checking" });
    fetch(`/api/admin/groups/${roomId}/test`)
      .then((r) => r.json())
      .then((d) => setTestState(d.seeded ? { phase: "seeded", report: d.report } : { phase: "idle" }))
      .catch(() => setTestState({ phase: "idle" }));
  }, [open, roomId, isPlatformAdmin]);

  async function patch(body: Record<string, unknown>) {
    return fetch(`/api/admin/groups/${roomId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function handleSave() {
    setSaving(true); setSaveMsg("");
    try {
      const res = await patch({
        name: settings.name,
        entryFee: parseFloat(settings.entryFee) || 0,
        status: settings.status,
      });
      setSaveMsg(res.ok ? "Saved" : ((await res.json()).error ?? "Failed"));
      if (res.ok) router.refresh();
    } catch { setSaveMsg("Network error"); }
    finally { setSaving(false); setTimeout(() => setSaveMsg(""), 3000); }
  }

  async function handleToggleLock() {
    const newStatus = settings.status === "locked" ? "open" : "locked";
    setSaving(true);
    try {
      const res = await patch({ status: newStatus });
      if (res.ok) { setSettings((s) => ({ ...s, status: newStatus })); router.refresh(); }
    } finally { setSaving(false); }
  }

  async function handleTransfer() {
    if (!transferTarget) return;
    const target = members.find((m) => m.userId === transferTarget);
    if (!confirm(`Transfer ownership to ${target?.name ?? "this member"}? You will lose admin controls.`)) return;
    setTransferring(true); setTransferMsg("");
    try {
      const res = await patch({ newCreatorId: transferTarget });
      if (res.ok) { setTransferMsg("Ownership transferred"); router.refresh(); setOpen(false); }
      else setTransferMsg((await res.json()).error ?? "Failed");
    } catch { setTransferMsg("Network error"); }
    finally { setTransferring(false); setTimeout(() => setTransferMsg(""), 4000); }
  }

  async function handleDisband() {
    if (!confirm("Permanently delete this group and all its data? This cannot be undone.")) return;
    if (!confirm("Last chance — are you absolutely sure?")) return;
    setDisbanding(true);
    try {
      const res = await fetch(`/api/admin/groups/${roomId}`, { method: "DELETE" });
      if (res.ok) router.push("/groups");
    } finally { setDisbanding(false); }
  }

  async function handleSeed() {
    setTestError(""); setTestState({ phase: "running" });
    try {
      const res = await fetch(`/api/admin/groups/${roomId}/test`, { method: "POST" });
      const d = await res.json();
      if (!res.ok) { setTestError(d.error ?? "Failed"); setTestState({ phase: "idle" }); return; }
      setTestState({ phase: "seeded", report: d.report }); router.refresh();
    } catch { setTestError("Network error"); setTestState({ phase: "idle" }); }
  }

  async function handleCleanupTest() {
    setTestError(""); setTestState({ phase: "cleaning" });
    try {
      await fetch(`/api/admin/groups/${roomId}/test`, { method: "DELETE" });
      setTestState({ phase: "idle" }); router.refresh();
    } catch { setTestError("Cleanup failed"); setTestState({ phase: "idle" }); }
  }

  const otherMembers = members.filter((m) => m.userId !== initialCreatorId);
  const predictionsLocked = ["locked", "active", "finished"].includes(settings.status);

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
          open ? "bg-violet-600 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white"
        }`}
      >
        <span className="text-sm">⚙</span> Admin
      </button>

      {open && (
        <div className="mt-4 bg-gray-900/80 border border-violet-500/30 rounded-xl p-5 space-y-5">
          {/* Top row: 2 columns */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left: Settings */}
            <div>
              <h3 className="text-xs font-bold text-violet-400 uppercase tracking-wide mb-3">Settings</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Name</label>
                  <input
                    type="text" value={settings.name}
                    onChange={(e) => setSettings((s) => ({ ...s, name: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Entry fee (€)</label>
                  <input
                    type="number" min="0" step="0.5" value={settings.entryFee}
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
                        onClick={() => setSettings((p) => ({ ...p, status: s }))}
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
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={handleSave} disabled={saving}
                    className="bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-colors"
                  >
                    {saving ? "Saving…" : "Save"}
                  </button>
                  <button
                    onClick={handleToggleLock} disabled={saving}
                    className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                      predictionsLocked
                        ? "border-yellow-500/50 bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20"
                        : "border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-500"
                    }`}
                  >
                    {predictionsLocked ? "🔒 Predictions locked" : "🔓 Lock predictions"}
                  </button>
                  {saveMsg && (
                    <span className={saveMsg === "Saved" ? "text-green-400 text-sm" : "text-red-400 text-sm"}>
                      {saveMsg}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Right: Transfer + Test simulation */}
            <div className="space-y-5">
              {/* Transfer ownership */}
              <div>
                <h3 className="text-xs font-bold text-violet-400 uppercase tracking-wide mb-3">Transfer Ownership</h3>
                <p className="text-xs text-gray-400 mb-2">
                  Make another member the group creator. You'll lose admin controls for this group.
                </p>
                <div className="flex gap-2">
                  <select
                    value={transferTarget}
                    onChange={(e) => setTransferTarget(e.target.value)}
                    className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500"
                  >
                    <option value="">Select member…</option>
                    {otherMembers.map((m) => (
                      <option key={m.userId} value={m.userId}>{m.name ?? m.userId}</option>
                    ))}
                  </select>
                  <button
                    onClick={handleTransfer}
                    disabled={!transferTarget || transferring}
                    className="bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-white text-sm font-semibold px-3 py-2 rounded-lg transition-colors"
                  >
                    {transferring ? "…" : "Transfer"}
                  </button>
                </div>
                {transferMsg && (
                  <p className={`text-xs mt-1 ${transferMsg.includes("transferred") ? "text-green-400" : "text-red-400"}`}>
                    {transferMsg}
                  </p>
                )}
              </div>

              {/* Test simulation — platform admin only */}
              {isPlatformAdmin && (
                <div>
                  <h3 className="text-xs font-bold text-violet-400 uppercase tracking-wide mb-2">Test Simulation</h3>
                  <p className="text-xs text-gray-400 mb-2">
                    Seed 5 fake players + Group A results to test the UI.
                  </p>
                  {testError && <p className="text-xs text-red-400 mb-1">{testError}</p>}
                  <div className="flex gap-2 mb-2">
                    {(testState.phase === "idle" || testState.phase === "checking") && (
                      <button onClick={handleSeed} disabled={testState.phase === "checking"}
                        className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors">
                        {testState.phase === "checking" ? "Checking…" : "▶ Seed & Simulate"}
                      </button>
                    )}
                    {testState.phase === "running" && (
                      <button disabled className="inline-flex items-center gap-1.5 bg-emerald-700 opacity-50 text-white text-xs font-semibold px-3 py-2 rounded-lg">
                        <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />Running…
                      </button>
                    )}
                    {testState.phase === "seeded" && (
                      <>
                        <span className="text-xs text-emerald-400 self-center">✓ Active</span>
                        <button onClick={handleCleanupTest}
                          className="ml-auto bg-red-800 hover:bg-red-700 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors">
                          🗑 Cleanup
                        </button>
                      </>
                    )}
                    {testState.phase === "cleaning" && (
                      <button disabled className="inline-flex items-center gap-1.5 bg-red-800 opacity-50 text-white text-xs font-semibold px-3 py-2 rounded-lg">
                        <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />Cleaning…
                      </button>
                    )}
                  </div>
                  {testState.phase === "seeded" && (
                    <div className="rounded-lg border border-gray-700 overflow-hidden">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-gray-700 text-gray-500">
                            <th className="text-left px-2 py-1">#</th>
                            <th className="text-left px-2 py-1">Player</th>
                            <th className="text-right px-2 py-1">Pts</th>
                            <th className="text-right px-2 py-1">Earned</th>
                          </tr>
                        </thead>
                        <tbody>
                          {testState.report.leaderboard.map((p, i) => (
                            <tr key={i} className="border-b border-gray-800 last:border-0">
                              <td className="px-2 py-1 text-gray-600">{i + 1}</td>
                              <td className="px-2 py-1 text-white">{p.name}</td>
                              <td className="px-2 py-1 text-right text-amber-400 font-bold">{p.points}</td>
                              <td className="px-2 py-1 text-right text-green-400">€{(p.earned ?? 0).toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Danger zone */}
          <div className="border border-red-800/40 rounded-xl p-4">
            <h3 className="text-xs font-bold text-red-400 uppercase tracking-wide mb-2">Danger Zone</h3>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-300 font-medium">Disband group</p>
                <p className="text-xs text-gray-500">Permanently deletes the group and all predictions, bets, and data. Cannot be undone.</p>
              </div>
              <button
                onClick={handleDisband} disabled={disbanding}
                className="ml-4 shrink-0 inline-flex items-center gap-1.5 bg-red-900 hover:bg-red-800 disabled:opacity-40 text-red-300 font-semibold px-4 py-2 rounded-lg text-sm transition-colors border border-red-700/50"
              >
                {disbanding ? "Disbanding…" : "🗑 Disband"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
