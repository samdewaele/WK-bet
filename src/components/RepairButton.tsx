"use client";

import { useState } from "react";

type RepairResult = {
  matchIdsSet: number;
  kickoffsFixed: number;
  teamIdsSet: number;
  unmatched: number;
  message: string;
};

export default function RepairButton() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RepairResult | null>(null);
  const [error, setError] = useState("");

  async function handleRepair() {
    setLoading(true);
    setResult(null);
    setError("");
    try {
      const res = await fetch("/api/admin/repair-db", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Repair failed");
      } else {
        setResult(data);
      }
    } catch {
      setError("Network error — could not reach server");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={handleRepair}
        disabled={loading}
        className="inline-flex items-center gap-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-colors"
      >
        {loading ? (
          <>
            <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Repairing…
          </>
        ) : (
          <>🔧 Repair DB (backfill API IDs)</>
        )}
      </button>

      {result && (
        <span className="text-sm text-green-400">{result.message}</span>
      )}
      {error && (
        <span className="text-sm text-red-400">{error}</span>
      )}
    </div>
  );
}
