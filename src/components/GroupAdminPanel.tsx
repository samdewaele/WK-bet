"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { TestTournamentReport } from "@/lib/test-tournament";

type Settings = { name: string; entryFee: string; status: string };
type TestState =
  | { phase: "checking" }
  | { phase: "idle" }
  | { phase: "running" }
  | { phase: "seeded"; simPhase: 1 | 2; report: TestTournamentReport }
  | { phase: "cleaning" };

type Member = { userId: string; name: string | null };

type BetEntry = { id: string; userId: string; userName: string | null; answer: string };
type UberBet = {
  id: string; title: string; status: string;
  winnerEntryId: string | null; entries: BetEntry[];
};

type MemberStat = {
  userId: string;
  name: string | null;
  email: string | null;
  paid: boolean;
  excludedFromPot: boolean;
  groupPredictions: number;
  totalGroupMatches: number;
  koPredictions: number;
  totalKOMatches: number;
  groupStandingGroups: number;
  totalGroupStandingGroups: number;
};

const STATUS_OPTIONS = ["setup", "open", "locked", "active", "finished"];

export default function GroupAdminPanel({
  roomId,
  initialName,
  initialFee,
  initialStatus,
  initialCreatorId,
  isPlatformAdmin,
  currentUserId,
  members,
}: {
  roomId: string;
  initialName: string;
  initialFee: number;
  initialStatus: string;
  initialCreatorId: string | null;
  isPlatformAdmin: boolean;
  currentUserId: string;
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

  // Members stats
  const [memberStats, setMemberStats] = useState<MemberStat[]>([]);
  const [memberStatsLoading, setMemberStatsLoading] = useState(false);
  const [togglingMember, setTogglingMember] = useState<string | null>(null);

  // Test simulation
  const [testState, setTestState] = useState<TestState>({ phase: "checking" });
  const [testError, setTestError] = useState("");
  const [uberBets, setUberBets] = useState<UberBet[]>([]);
  const [settlingBet, setSettlingBet] = useState<string | null>(null);
  const [pendingWinner, setPendingWinner] = useState<{ betId: string; entryId: string } | null>(null);

  const loadMemberStats = useCallback(() => {
    setMemberStatsLoading(true);
    fetch(`/api/admin/groups/${roomId}/members`)
      .then((r) => r.json())
      .then((d) => setMemberStats(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setMemberStatsLoading(false));
  }, [roomId]);

  const loadUberBets = useCallback(() => {
    fetch(`/api/groups/${roomId}/sidebets`)
      .then((r) => r.json())
      .then((d) => setUberBets(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, [roomId]);

  useEffect(() => {
    if (!open) return;
    if (isPlatformAdmin) {
      setTestState({ phase: "checking" });
      fetch(`/api/admin/groups/${roomId}/test`)
        .then((r) => r.json())
        .then((d) => {
          if (!d.seeded) { setTestState({ phase: "idle" }); return; }
          const simPhase = d.phase === 2 ? 2 : 1;
          setTestState({ phase: "seeded", simPhase, report: d.report });
          if (simPhase === 2) loadUberBets();
        })
        .catch(() => setTestState({ phase: "idle" }));
    }
    loadMemberStats();
  }, [open, roomId, isPlatformAdmin, loadMemberStats, loadUberBets]);

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

  async function handleToggleExclude(userId: string, currentlyExcluded: boolean) {
    setTogglingMember(userId);
    try {
      await fetch(`/api/admin/groups/${roomId}/members`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, excludedFromPot: !currentlyExcluded }),
      });
      setMemberStats((prev) =>
        prev.map((m) => m.userId === userId ? { ...m, excludedFromPot: !currentlyExcluded } : m)
      );
      router.refresh();
    } finally { setTogglingMember(null); }
  }

  async function handleSettleBet(betId: string, winnerEntryId: string) {
    setPendingWinner(null);
    setSettlingBet(betId);
    try {
      const res = await fetch(`/api/groups/${roomId}/sidebets`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sideBetId: betId, winnerEntryId }),
      });
      if (res.ok) { loadUberBets(); router.refresh(); }
    } finally { setSettlingBet(null); }
  }

  async function handleSeed(simPhase: 1 | 2) {
    const prevState = testState;
    setTestError(""); setTestState({ phase: "running" });
    try {
      const res = await fetch(`/api/admin/groups/${roomId}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase: simPhase }),
      });
      const d = await res.json();
      if (!res.ok) {
        setTestError(d.error ?? "Failed");
        setTestState(prevState.phase === "seeded" ? prevState : { phase: "idle" });
        return;
      }
      setTestState({ phase: "seeded", simPhase, report: d.report });
      router.refresh();
      loadMemberStats();
      if (simPhase === 2) loadUberBets();
    } catch {
      setTestError("Network error");
      setTestState(prevState.phase === "seeded" ? prevState : { phase: "idle" });
    }
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
                  Make another member the group creator. You&apos;ll lose admin controls for this group.
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
                    Adds 5 fake players + random results. <strong className="text-gray-300">Requires at least 1 open Uber Pot bet with answers first.</strong>
                    {" "}Phase 1 simulates group stage. Then all members fill in KO predictions. Phase 2 simulates KO rounds. Then you settle the Uber Pot bets below.
                  </p>
                  {testError && <p className="text-xs text-red-400 mb-1">{testError}</p>}
                  <div className="flex flex-wrap gap-2 mb-2">
                    {(testState.phase === "idle" || testState.phase === "checking") && (
                      <button onClick={() => handleSeed(1)} disabled={testState.phase === "checking"}
                        className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors">
                        {testState.phase === "checking" ? "Checking…" : "▶ Phase 1: Group Stage"}
                      </button>
                    )}
                    {testState.phase === "running" && (
                      <button disabled className="inline-flex items-center gap-1.5 bg-emerald-700 opacity-50 text-white text-xs font-semibold px-3 py-2 rounded-lg">
                        <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />Running…
                      </button>
                    )}
                    {testState.phase === "seeded" && testState.simPhase === 1 && (() => {
                      const koReadyCount = memberStats.filter(m => m.koPredictions >= m.totalKOMatches && m.totalKOMatches > 0).length;
                      const totalMembers = memberStats.length;
                      const myStats = memberStats.find(m => m.userId === currentUserId);
                      const adminHasKOPreds = myStats ? myStats.koPredictions > 0 : false;
                      return (
                        <>
                          <span className="text-xs text-emerald-400 self-center">✓ Group stage</span>
                          <button onClick={() => handleSeed(2)}
                            disabled={!adminHasKOPreds}
                            title={!adminHasKOPreds ? "You must submit your KO predictions first" : undefined}
                            className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors">
                            ▶ Phase 2: KO Round
                          </button>
                          <button onClick={handleCleanupTest}
                            className="ml-auto bg-red-800 hover:bg-red-700 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors">
                            🗑 Cleanup
                          </button>
                          <p className="w-full text-xs text-gray-500 mt-1">
                            KO predictions ready: <span className={koReadyCount === totalMembers ? "text-emerald-400 font-semibold" : "text-amber-400 font-semibold"}>{koReadyCount}/{totalMembers}</span> members — wait for everyone before running Phase 2.
                          </p>
                          {!adminHasKOPreds && (
                            <p className="w-full text-xs text-red-400 mt-1">
                              ⚠ Submit your own KO predictions first before running Phase 2.
                            </p>
                          )}
                        </>
                      );
                    })()}
                    {testState.phase === "seeded" && testState.simPhase === 2 && (
                      <>
                        <span className="text-xs text-emerald-400 self-center">✓ KO simulated</span>
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

                  {/* Earnings report */}
                  {testState.phase === "seeded" && (
                    <div className="rounded-lg border border-gray-700 overflow-hidden mb-3">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-gray-700 text-gray-500">
                            <th className="text-left px-2 py-1">#</th>
                            <th className="text-left px-2 py-1">Player</th>
                            <th className="text-right px-2 py-1">Earned</th>
                          </tr>
                        </thead>
                        <tbody>
                          {testState.report.leaderboard.map((p, i) => (
                            <tr key={i} className="border-b border-gray-800 last:border-0">
                              <td className="px-2 py-1 text-gray-600">{i + 1}</td>
                              <td className="px-2 py-1 text-white">{p.name}</td>
                              <td className="px-2 py-1 text-right text-green-400">€{(p.earned ?? 0).toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Uber Pot bet settlement — shown after Phase 2 */}
                  {testState.phase === "seeded" && testState.simPhase === 2 && (
                    <div className="border border-amber-500/30 rounded-lg p-3">
                      <p className="text-xs font-semibold text-amber-400 mb-2">Settle Uber Pot Bets</p>
                      {uberBets.filter(b => b.status !== "settled").length === 0 && uberBets.length > 0 ? (
                        <p className="text-xs text-emerald-400">✓ All bets settled!</p>
                      ) : uberBets.length === 0 ? (
                        <p className="text-xs text-gray-500">No Uber Pot bets found.</p>
                      ) : (
                        uberBets.filter(b => b.status !== "settled").map(bet => (
                          <div key={bet.id} className="mb-3 last:mb-0">
                            <p className="text-xs text-white font-medium mb-1.5">{bet.title}</p>
                            {bet.entries.length === 0 ? (
                              <p className="text-xs text-gray-600 italic">No entries submitted.</p>
                            ) : (
                              <div className="space-y-1">
                                {bet.entries.map(entry => {
                                  const isPending = pendingWinner?.betId === bet.id && pendingWinner?.entryId === entry.id;
                                  const isSettling = settlingBet === bet.id;
                                  return (
                                    <div key={entry.id} className={`flex items-center justify-between text-xs rounded px-2 py-1.5 ${isPending ? "bg-amber-500/10 border border-amber-500/30" : "bg-gray-800"}`}>
                                      <span className="text-gray-300 flex-1 min-w-0 mr-2 truncate">
                                        <span className="font-medium text-white">{entry.userName ?? "?"}</span>
                                        : {entry.answer}
                                      </span>
                                      {!isPending ? (
                                        <button
                                          onClick={() => setPendingWinner({ betId: bet.id, entryId: entry.id })}
                                          disabled={isSettling}
                                          className="shrink-0 text-xs bg-gray-700 hover:bg-green-700 text-gray-300 hover:text-white px-2 py-0.5 rounded transition-colors disabled:opacity-40 border border-gray-600 hover:border-green-600"
                                        >
                                          Set winner
                                        </button>
                                      ) : (
                                        <div className="flex items-center gap-1 shrink-0">
                                          <span className="text-amber-300">Confirm?</span>
                                          <button
                                            onClick={() => handleSettleBet(bet.id, entry.id)}
                                            disabled={isSettling}
                                            className="text-xs bg-green-700 hover:bg-green-600 text-white px-2 py-0.5 rounded font-semibold disabled:opacity-40"
                                          >
                                            {isSettling ? "…" : "Yes"}
                                          </button>
                                          <button
                                            onClick={() => setPendingWinner(null)}
                                            className="text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded"
                                          >
                                            No
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        ))
                      )}
                      {uberBets.filter(b => b.status === "settled").map(bet => {
                        const winner = bet.entries.find(e => e.id === bet.winnerEntryId);
                        return (
                          <div key={bet.id} className="text-xs text-emerald-400/70 flex items-center gap-1 mt-1">
                            <span>✓</span>
                            <span className="truncate">{bet.title}: <strong>{winner?.userName}</strong> &ldquo;{winner?.answer}&rdquo;</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Members section */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-violet-400 uppercase tracking-wide">Members & Prize Pool</h3>
              <button onClick={loadMemberStats} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
                ↻ Refresh
              </button>
            </div>
            {memberStatsLoading ? (
              <p className="text-xs text-gray-500">Loading…</p>
            ) : (
              <div className="rounded-lg border border-gray-700 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-700 bg-gray-800/50">
                      <th className="text-left px-3 py-2 text-gray-500 font-medium">Member</th>
                      <th className="text-center px-2 py-2 text-gray-500 font-medium">KO preds</th>
                      <th className="text-center px-2 py-2 text-gray-500 font-medium">Standings</th>
                      <th className="text-center px-2 py-2 text-gray-500 font-medium">Paid</th>
                      <th className="text-right px-3 py-2 text-gray-500 font-medium">Pot</th>
                    </tr>
                  </thead>
                  <tbody>
                    {memberStats.map((m) => {
                      const koComplete = m.totalKOMatches === 0 || m.koPredictions >= m.totalKOMatches;
                      const standingsComplete = m.groupStandingGroups >= m.totalGroupStandingGroups;
                      // #12: isIncomplete only checks standings (group match scores are bonus only)
                      const isIncomplete = !standingsComplete;
                      return (
                        <tr key={m.userId} className={`border-b border-gray-800 last:border-0 ${m.excludedFromPot ? "opacity-50" : ""}`}>
                          <td className="px-3 py-2 text-white font-medium">
                            {m.name ?? m.email ?? m.userId}
                            {m.excludedFromPot && <span className="ml-1.5 text-red-400 font-normal">(excluded)</span>}
                          </td>
                          <td className={`px-2 py-2 text-center ${koComplete ? "text-green-400" : "text-gray-500"}`}>
                            {m.koPredictions}/{m.totalKOMatches}
                          </td>
                          <td className={`px-2 py-2 text-center ${standingsComplete ? "text-green-400" : "text-amber-400"}`}>
                            {m.groupStandingGroups}/{m.totalGroupStandingGroups}
                          </td>
                          <td className="px-2 py-2 text-center">
                            <span className={m.paid ? "text-green-400" : "text-gray-600"}>
                              {m.paid ? "✓" : "–"}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              onClick={() => handleToggleExclude(m.userId, m.excludedFromPot)}
                              disabled={togglingMember === m.userId}
                              title={m.excludedFromPot ? "Re-include in pot" : "Exclude from pot"}
                              className={`text-xs px-2 py-0.5 rounded transition-colors disabled:opacity-40 ${
                                m.excludedFromPot
                                  ? "bg-gray-700 hover:bg-gray-600 text-gray-300"
                                  : isIncomplete
                                    ? "bg-amber-800/60 hover:bg-amber-800 text-amber-300 border border-amber-700/50"
                                    : "bg-gray-800 hover:bg-gray-700 text-gray-400"
                              }`}
                            >
                              {m.excludedFromPot ? "Re-include" : "Exclude"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {memberStats.some((m) => !m.excludedFromPot && m.groupStandingGroups < m.totalGroupStandingGroups) && (
                  <p className="text-xs text-amber-400/70 px-3 py-2 border-t border-gray-700">
                    Members with amber standings counts have not completed all group predictions. Excluding them removes their share from the pot.
                  </p>
                )}
              </div>
            )}
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
