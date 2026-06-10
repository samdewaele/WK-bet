"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { TestTournamentReport } from "@/lib/test-tournament";

type Settings = { name: string; entryFee: string; status: string; simulationMode: boolean; description: string; uberBetsLocked: boolean };
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
  uberBets: number;
  totalUberBets: number;
};

const STATUS_LABELS: Record<string, string> = {
  setup: "Setup",
  betting: "Open for bets",
  closed: "Closed",
  group_active: "Group stage",
  ko_betting: "KO betting",
  ko_active: "KO stage",
  settling: "Settling",
  finished: "Finished",
};

export default function GroupAdminPanel({
  roomId,
  inviteCode,
  initialName,
  initialFee,
  initialStatus,
  initialSimulationMode,
  initialCreatorId,
  isPlatformAdmin,
  currentUserId,
  members,
  initialDescription,
  initialUberBetsLocked,
  initialImage,
}: {
  roomId: string;
  inviteCode: string;
  initialName: string;
  initialFee: number;
  initialStatus: string;
  initialSimulationMode: boolean;
  initialCreatorId: string | null;
  isPlatformAdmin: boolean;
  currentUserId: string;
  members: Member[];
  initialDescription?: string | null;
  initialUberBetsLocked?: boolean;
  initialImage?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  function copyInviteLink() {
    const url = `${window.location.origin}/join/${inviteCode}`;
    navigator.clipboard.writeText(url).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2500);
    });
  }

  // Settings
  const [settings, setSettings] = useState<Settings>({
    name: initialName, entryFee: initialFee.toFixed(2), status: initialStatus, simulationMode: initialSimulationMode,
    description: initialDescription ?? "", uberBetsLocked: initialUberBetsLocked ?? false,
  });
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  // Transfer
  const [transferTarget, setTransferTarget] = useState("");
  const [transferring, setTransferring] = useState(false);
  const [transferMsg, setTransferMsg] = useState("");

  // Disband
  const [disbanding, setDisbanding] = useState(false);
  const [broadcastSubject, setBroadcastSubject] = useState("");
  const [broadcastMessage, setBroadcastMessage] = useState("");
  const [broadcasting, setBroadcasting] = useState(false);
  const [broadcastStatus, setBroadcastStatus] = useState<"idle" | "sent" | "error">("idle");

  // Reseed teams (platform admin)
  const [reseeding, setReseeding] = useState(false);
  const [reseedResult, setReseedResult] = useState<string | null>(null);

  // Group image
  const [image, setImage] = useState<string | null>(initialImage ?? null);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState("");

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
        description: settings.description || null,
      });
      setSaveMsg(res.ok ? "Saved" : ((await res.json()).error ?? "Failed"));
      if (res.ok) router.refresh();
    } catch { setSaveMsg("Network error"); }
    finally { setSaving(false); setTimeout(() => setSaveMsg(""), 3000); }
  }

  async function handleStatusTransition(newStatus: string) {
    setSaving(true);
    try {
      const res = await patch({ status: newStatus });
      if (res.ok) { setSettings((s) => ({ ...s, status: newStatus })); router.refresh(); }
      else setSaveMsg((await res.json()).error ?? "Failed");
    } catch { setSaveMsg("Network error"); }
    finally { setSaving(false); setTimeout(() => setSaveMsg(""), 3000); }
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

  async function handleBroadcast() {
    if (!broadcastSubject.trim() || !broadcastMessage.trim()) return;
    setBroadcasting(true);
    setBroadcastStatus("idle");
    try {
      const res = await fetch(`/api/admin/groups/${roomId}/broadcast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: broadcastSubject, message: broadcastMessage }),
      });
      setBroadcastStatus(res.ok ? "sent" : "error");
      if (res.ok) { setBroadcastSubject(""); setBroadcastMessage(""); }
    } finally {
      setBroadcasting(false);
      setTimeout(() => setBroadcastStatus("idle"), 4000);
    }
  }

  async function handleReseedTeams() {
    if (!confirm("Rebuild all group-stage matches from the current team list? This deletes and recreates all group matches but leaves KO matches and user data untouched.")) return;
    setReseeding(true);
    setReseedResult(null);
    try {
      const res = await fetch("/api/admin/reseed-teams", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setReseedResult(`✓ Done — ${data.teamsUpserted} teams, ${data.groupMatchesRebuilt} group matches rebuilt, ${data.staleTeamsRemoved} stale teams removed`);
      } else {
        setReseedResult(`✗ ${data.error ?? "Failed"}`);
      }
    } catch {
      setReseedResult("✗ Network error");
    } finally {
      setReseeding(false);
    }
  }

  // Downscale a chosen image to a small square avatar (data URL) before saving.
  function downscaleImage(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const size = 256;
          const canvas = document.createElement("canvas");
          canvas.width = size; canvas.height = size;
          const ctx = canvas.getContext("2d");
          if (!ctx) return reject(new Error("Canvas unsupported"));
          // cover-crop to square
          const scale = Math.max(size / img.width, size / img.height);
          const w = img.width * scale, h = img.height * scale;
          ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
          resolve(canvas.toDataURL("image/jpeg", 0.8));
        };
        img.onerror = () => reject(new Error("Invalid image"));
        img.src = reader.result as string;
      };
      reader.onerror = () => reject(new Error("Could not read file"));
      reader.readAsDataURL(file);
    });
  }

  async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    if (!file.type.startsWith("image/")) { setImageError("Please choose an image file"); return; }
    setImageBusy(true); setImageError("");
    try {
      const dataUrl = await downscaleImage(file);
      const res = await patch({ image: dataUrl });
      if (res.ok) { setImage(dataUrl); router.refresh(); }
      else setImageError((await res.json()).error ?? "Upload failed");
    } catch (err) {
      setImageError(err instanceof Error ? err.message : "Upload failed");
    } finally { setImageBusy(false); }
  }

  async function handleImageRemove() {
    setImageBusy(true); setImageError("");
    try {
      const res = await patch({ image: null });
      if (res.ok) { setImage(null); router.refresh(); }
      else setImageError((await res.json()).error ?? "Failed");
    } catch { setImageError("Failed"); }
    finally { setImageBusy(false); }
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
      // For Phase 2, refresh stats so the member table stays up to date
      if (simPhase === 2) {
        const statsRes = await fetch(`/api/admin/groups/${roomId}/members`);
        const freshStats: MemberStat[] = await statsRes.json();
        if (Array.isArray(freshStats)) setMemberStats(freshStats);
      }

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
      setSettings((s) => ({ ...s, status: "setup", simulationMode: false }));
      setTestState({ phase: "idle" }); router.refresh();
    } catch { setTestError("Cleanup failed"); setTestState({ phase: "idle" }); }
  }

  const otherMembers = members.filter((m) => m.userId !== initialCreatorId);
  const currentStatus = settings.status;

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
          {/* Invite link — always visible to managers */}
          <div>
            <h3 className="text-xs font-bold text-violet-400 uppercase tracking-wide mb-2">Invite link</h3>
            <div className="flex items-center gap-2 flex-wrap">
              <code className="flex-1 min-w-0 text-xs bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-300 truncate select-all">
                {typeof window !== "undefined" ? `${window.location.origin}/join/${inviteCode}` : `/join/${inviteCode}`}
              </code>
              <button
                onClick={copyInviteLink}
                className="shrink-0 inline-flex items-center gap-1.5 text-xs bg-violet-600 hover:bg-violet-500 text-white font-semibold px-3 py-2 rounded-lg transition-colors"
              >
                {linkCopied ? <>✓ Copied!</> : <>🔗 Copy</>}
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">Share this link so friends can join — they'll be added automatically after signing in.</p>
          </div>

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
                  <label className="block text-xs text-gray-400 mb-1">Group description (optional)</label>
                  <textarea
                    value={settings.description}
                    onChange={(e) => setSettings((s) => ({ ...s, description: e.target.value }))}
                    placeholder="House rules, payment info, contact details…"
                    rows={2}
                    maxLength={500}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500 resize-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Group image (optional)</label>
                  <div className="flex items-center gap-3">
                    {image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={image} alt="Group" className="w-14 h-14 rounded-lg object-cover border border-gray-700" />
                    ) : (
                      <div className="w-14 h-14 rounded-lg bg-gray-800 border border-gray-700 flex items-center justify-center text-2xl">⚽</div>
                    )}
                    <div className="flex flex-col gap-1.5">
                      <label className={`text-xs font-semibold px-3 py-1.5 rounded-lg cursor-pointer transition-colors w-fit ${imageBusy ? "bg-gray-700 text-gray-400" : "bg-violet-600 hover:bg-violet-500 text-white"}`}>
                        {imageBusy ? "Saving…" : image ? "Change image" : "Upload image"}
                        <input type="file" accept="image/*" onChange={handleImageChange} disabled={imageBusy} className="hidden" />
                      </label>
                      {image && !imageBusy && (
                        <button onClick={handleImageRemove} className="text-xs text-gray-400 hover:text-red-400 transition-colors w-fit">
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                  {imageError && <p className="text-xs text-red-400 mt-1">{imageError}</p>}
                </div>

                {/* Status — current stage + contextual action buttons */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Stage</label>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${
                      currentStatus === "setup" ? "border-gray-600 bg-gray-700 text-gray-300" :
                      currentStatus === "betting" ? "border-blue-500/50 bg-blue-500/10 text-blue-300" :
                      currentStatus === "closed" ? "border-orange-500/50 bg-orange-500/10 text-orange-300" :
                      currentStatus === "group_active" ? "border-green-500/50 bg-green-500/10 text-green-300" :
                      currentStatus === "ko_betting" ? "border-amber-500/50 bg-amber-500/10 text-amber-300" :
                      currentStatus === "ko_active" ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300" :
                      "border-purple-500/50 bg-purple-500/10 text-purple-300"
                    }`}>
                      {STATUS_LABELS[currentStatus] ?? currentStatus}
                    </span>
                    {settings.simulationMode && (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-violet-500/20 border border-violet-500/40 text-violet-300">
                        🧪 SIM
                      </span>
                    )}
                  </div>

                  {/* Contextual transition buttons */}
                  <div className="flex flex-wrap gap-2 mt-2">
                    {currentStatus === "setup" && (
                      <button onClick={() => handleStatusTransition("betting")} disabled={saving}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white transition-colors">
                        Open for bets →
                      </button>
                    )}
                    {currentStatus === "betting" && (
                      <>
                        <button onClick={() => handleStatusTransition("setup")} disabled={saving}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-gray-300 transition-colors">
                          ← Back to setup
                        </button>
                        <button onClick={() => handleStatusTransition("closed")} disabled={saving}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-orange-700 hover:bg-orange-600 disabled:opacity-40 text-white transition-colors">
                          Close (no new members) →
                        </button>
                      </>
                    )}
                    {currentStatus === "closed" && (
                      <button onClick={() => handleStatusTransition("betting")} disabled={saving}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-600 disabled:opacity-40 text-white transition-colors">
                        ← Reopen for bets
                      </button>
                    )}
                    {currentStatus === "group_active" && (
                      <p className="text-xs text-gray-500 italic">Transitions automatically based on match schedule.</p>
                    )}
                    {currentStatus === "ko_betting" && (
                      <div className="w-full">
                        <button onClick={() => handleStatusTransition("ko_active")} disabled={saving}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white transition-colors">
                          Start KO stage →
                        </button>
                        <p className="text-xs text-gray-500 mt-1.5">Normally transitions automatically when the first KO match kicks off. Use this if it gets stuck.</p>
                      </div>
                    )}
                    {currentStatus === "ko_active" && (
                      <div className="w-full">
                        <button onClick={() => handleStatusTransition("settling")} disabled={saving}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-600 disabled:opacity-40 text-white transition-colors">
                          Move to settling →
                        </button>
                        <p className="text-xs text-gray-500 mt-1.5">Normally transitions automatically after the Final. Use this if it gets stuck.</p>
                      </div>
                    )}
                    {currentStatus === "settling" && (
                      <div className="w-full">
                        <button onClick={() => handleStatusTransition("finished")} disabled={saving}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-purple-700 hover:bg-purple-600 disabled:opacity-40 text-white transition-colors">
                          Finish tournament →
                        </button>
                        <p className="text-xs text-gray-500 mt-1.5">Settle every open Uber Pot bet below first — finishing is blocked until all are settled.</p>
                      </div>
                    )}
                    {currentStatus === "finished" && (
                      <p className="text-xs text-emerald-400">Tournament complete.</p>
                    )}
                  </div>
                </div>

                {/* Uber Pot lock */}
                <div className="flex items-center justify-between gap-3 pt-1">
                  <div>
                    <p className="text-xs text-gray-300 font-medium">Lock Uber Pot bets</p>
                    <p className="text-xs text-gray-500">Prevents new proposals and answer submissions.</p>
                  </div>
                  <button
                    onClick={async () => {
                      const next = !settings.uberBetsLocked;
                      setSaving(true);
                      try {
                        const res = await patch({ uberBetsLocked: next });
                        if (res.ok) { setSettings((s) => ({ ...s, uberBetsLocked: next })); router.refresh(); }
                        else setSaveMsg((await res.json()).error ?? "Failed");
                      } catch { setSaveMsg("Network error"); }
                      finally { setSaving(false); setTimeout(() => setSaveMsg(""), 3000); }
                    }}
                    disabled={saving}
                    aria-label={settings.uberBetsLocked ? "Unlock Uber Pot bets" : "Lock Uber Pot bets"}
                    className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-40 ${
                      settings.uberBetsLocked
                        ? "bg-amber-500/20 border-amber-500/40 text-amber-300 hover:bg-amber-500/30"
                        : "bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600"
                    }`}
                  >
                    {settings.uberBetsLocked ? "🔒 Locked" : "🔓 Unlocked"}
                  </button>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={handleSave} disabled={saving}
                    className="bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-colors"
                  >
                    {saving ? "Saving…" : "Save"}
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

              {/* Test simulation — platform admin only, setup status only */}
              {isPlatformAdmin && (currentStatus === "setup" || settings.simulationMode) && (
                <div>
                  <h3 className="text-xs font-bold text-violet-400 uppercase tracking-wide mb-2">Test Simulation</h3>
                  {currentStatus !== "setup" && !settings.simulationMode ? (
                    <p className="text-xs text-gray-500 italic">Simulation is only available while the group is in Setup. Move back to Setup first.</p>
                  ) : (
                  <>
                  <p className="text-xs text-gray-400 mb-2">
                    Adds 5 fake players + random results. <strong className="text-gray-300">Requires at least 1 open Uber Pot bet with answers first.</strong>
                    {" "}Phase 1 simulates group stage. Then all members fill in KO predictions. Phase 2 simulates KO rounds. Then you settle the Uber Pot bets below. Cleanup resets the group back to Setup.
                  </p>
                  {testError && <p className="text-xs text-red-400 mb-1">{testError}</p>}
                  <div className="flex flex-wrap gap-2 mb-2">
                    {(testState.phase === "idle" || testState.phase === "checking") && currentStatus === "setup" && (
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
                      const totalKO = memberStats[0]?.totalKOMatches ?? 0;
                      const membersReady = memberStats.filter(m => m.koPredictions >= totalKO && totalKO > 0).length;
                      const allReady = totalKO > 0 && membersReady === memberStats.length;
                      return (
                        <>
                          <span className="text-xs text-emerald-400 self-center">✓ Group stage</span>
                          <button onClick={() => handleSeed(2)}
                            title="Checks member readiness live before proceeding"
                            className="bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors">
                            ▶ Phase 2: KO Round
                          </button>
                          <button onClick={handleCleanupTest}
                            className="ml-auto bg-red-800 hover:bg-red-700 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors">
                            🗑 Cleanup
                          </button>
                          {totalKO > 0 && (
                            <p className="w-full text-xs text-gray-500 mt-1">
                              {membersReady}/{memberStats.length} members have a full KO bracket (members without predictions get 0 pts for missing matches).
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
                </>
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
                      <th className="text-center px-2 py-2 text-gray-500 font-medium">Uber bets</th>
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
                          <td className={`px-2 py-2 text-center ${m.totalUberBets === 0 ? "text-gray-600" : m.uberBets >= m.totalUberBets ? "text-green-400" : "text-amber-400"}`}>
                            {m.totalUberBets === 0 ? "–" : `${m.uberBets}/${m.totalUberBets}`}
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

          {/* Broadcast email */}
          <div className="border border-gray-700 rounded-xl p-4">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">📢 Send Email to All Members</h3>
            <div className="space-y-2">
              <input
                type="text"
                value={broadcastSubject}
                onChange={(e) => setBroadcastSubject(e.target.value)}
                placeholder="Subject"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-amber-400"
              />
              <textarea
                value={broadcastMessage}
                onChange={(e) => setBroadcastMessage(e.target.value)}
                placeholder="Message body…"
                rows={4}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-amber-400 resize-none"
              />
              <div className="flex items-center justify-end gap-3">
                {broadcastStatus === "sent" && <span className="text-xs text-green-400">✓ Sent to all members</span>}
                {broadcastStatus === "error" && <span className="text-xs text-red-400">Failed — try again</span>}
                <button
                  onClick={handleBroadcast}
                  disabled={broadcasting || !broadcastSubject.trim() || !broadcastMessage.trim()}
                  className="bg-amber-400 hover:bg-amber-300 disabled:opacity-40 disabled:cursor-not-allowed text-gray-900 font-semibold px-4 py-1.5 rounded-lg text-sm transition-colors"
                >
                  {broadcasting ? "Sending…" : "Send to all"}
                </button>
              </div>
            </div>
          </div>

          {/* Reseed teams — platform admin only */}
          {isPlatformAdmin && (
            <div className="border border-violet-800/40 rounded-xl p-4">
              <h3 className="text-xs font-bold text-violet-400 uppercase tracking-wide mb-2">Repair Team Data</h3>
              <p className="text-xs text-gray-400 mb-3">
                Rebuilds teams and group-stage matches from the authoritative FIFA WC 2026 draw. Use this to fix stale teams showing in group dropdowns. KO matches and all user data are untouched.
              </p>
              {reseedResult && (
                <p className={`text-xs mb-2 ${reseedResult.startsWith("✓") ? "text-green-400" : "text-red-400"}`}>
                  {reseedResult}
                </p>
              )}
              <button
                onClick={handleReseedTeams}
                disabled={reseeding}
                className="bg-violet-700 hover:bg-violet-600 disabled:opacity-40 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
              >
                {reseeding ? "Rebuilding…" : "🔄 Rebuild Group Matches"}
              </button>
            </div>
          )}

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
