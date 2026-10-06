/**
 * Starts the in-process background loop (outbox + reconciliation poller) on a long-running Node
 * server — `next dev` / `next start`. On Vercel (process.env.VERCEL) functions don't live between
 * requests, so Vercel Cron (/api/cron/tick), after() and open SSE streams drive the same tick().
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.VERCEL || process.env.NODE_ENV === "test") return;
  const { startBackgroundLoop } = await import("./lib/worker/tick");
  startBackgroundLoop();
}
