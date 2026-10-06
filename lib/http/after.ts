import { after } from "next/server";
import { log } from "@/lib/log";

/**
 * Run work after the HTTP response is sent. Inside a Next request this is `after()` (which keeps a
 * Vercel function alive via waitUntil); outside one (scripts, tests) Next throws, and the work is
 * scheduled on the event loop instead. Failures are logged — the work it runs (outbox processing)
 * is also picked up by the background tick, so nothing depends on this succeeding.
 */
export function runAfterResponse(label: string, work: () => Promise<unknown>): void {
  const guarded = async () => {
    try {
      await work();
    } catch (err) {
      log.error({ err, label }, "after-response work failed; the background tick will retry");
    }
  };
  try {
    after(guarded);
  } catch (outsideRequest) {
    log.debug({ label, reason: String(outsideRequest) }, "no request scope; scheduling on the event loop");
    setImmediate(() => void guarded());
  }
}
