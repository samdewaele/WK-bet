// Runs once when the Next.js server starts.
// Schedules automatic match result syncing every 5 minutes in production
// when FOOTBALL_DATA_API_KEY is present.

const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const WARMUP_DELAY_MS = 30_000;          // let DB settle before first sync

export async function register() {
  // register() is called for every runtime. Skip the Edge invocation.
  // NEXT_RUNTIME is "edge" in Edge, "nodejs" in Node.js, or absent — only
  // skip when explicitly "edge" so the guard works in all Node.js contexts.
  if (process.env.NEXT_RUNTIME === "edge") return;
  // No API key → nothing to sync
  if (!process.env.FOOTBALL_DATA_API_KEY) return;

  const { syncMatches } = await import("@/lib/sync-matches");

  const run = async () => {
    try {
      const result = await syncMatches();
      if (result.updated > 0) {
        console.log(`[cron/sync] ${result.message}`);
      }
    } catch (err) {
      console.error("[cron/sync] error:", err instanceof Error ? err.message : err);
    }
  };

  // First sync after warmup, then on a fixed interval
  console.log(`[cron/sync] Starting — first sync in ${WARMUP_DELAY_MS / 1000}s, then every ${SYNC_INTERVAL_MS / 60000} min`);
  setTimeout(() => {
    run();
    setInterval(run, SYNC_INTERVAL_MS);
  }, WARMUP_DELAY_MS);
}
