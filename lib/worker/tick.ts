import { log } from "@/lib/log";
import { processOutboxBatch } from "./outbox";
import { pollOnce } from "./poller";

/**
 * One background pass: drain due outbox rows, then reconcile anything Kora hasn't told us about.
 * Called by the in-process loop (local / long-running server), by Vercel Cron via /api/cron/tick,
 * and opportunistically while an order's SSE stream is open.
 */

let running: Promise<TickReport> | null = null;

export type TickReport = { outbox: Awaited<ReturnType<typeof processOutboxBatch>>; poll: Awaited<ReturnType<typeof pollOnce>> };

export function tick(): Promise<TickReport> {
  // Never overlap passes within one process; other processes are kept apart by row locks.
  if (running) return running;
  running = (async () => {
    try {
      const outbox = await processOutboxBatch();
      const poll = await pollOnce();
      if (outbox.processed || outbox.retried || outbox.parked || poll.charges || poll.payouts || poll.refunds || poll.healed || poll.errors) {
        log.info({ outbox, poll }, "tick");
      }
      return { outbox, poll };
    } finally {
      running = null;
    }
  })();
  return running;
}

let loop: NodeJS.Timeout | null = null;

export function startBackgroundLoop(intervalMs = 5_000): void {
  if (loop) return;
  log.info({ intervalMs }, "background loop started (outbox + reconciliation poller)");
  loop = setInterval(() => {
    tick().catch((err: unknown) => log.error({ err }, "background tick failed"));
  }, intervalMs);
  loop.unref();
}

export function stopBackgroundLoop(): void {
  if (loop) clearInterval(loop);
  loop = null;
}
