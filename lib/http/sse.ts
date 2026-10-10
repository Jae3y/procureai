import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { subscribe } from "@/lib/realtime/listener";
import { tick } from "@/lib/worker/tick";
import { jsonText } from "./idempotency";

/**
 * Server-Sent Events. Every message is a full `snapshot` of the view, tagged with the id of the
 * newest timeline row it contains. EventSource reconnects on its own after a drop; the first thing
 * a (re)connected client receives is a fresh snapshot, so missed events are always backfilled and
 * the timeline is never left with a gap.
 *
 * Push comes from Postgres NOTIFY. A 15 s safety check re-reads the cursor in case a notification was
 * missed, and — where no in-process worker runs (Vercel) — drives a background tick while someone is
 * watching, so the reconciliation poller keeps working.
 */

const SAFETY_RECHECK_MS = 15_000;
const STREAM_TICK_MS = 60_000;

export function sseResponse(opts: {
  req: Request;
  channel: `order:${string}` | `request:${string}`;
  snapshot: () => Promise<{ cursor: string; data: unknown }>;
}): Response {
  const encoder = new TextEncoder();
  let closed = false;
  let unsubscribe: (() => void) | null = null;
  const timers: NodeJS.Timeout[] = [];

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let lastCursor = "";
      let sending = false;
      let again = false;

      const write = (chunk: string) => {
        if (!closed) controller.enqueue(encoder.encode(chunk));
      };

      const push = async (force = false) => {
        if (closed) return;
        if (sending) {
          again = true;
          return;
        }
        sending = true;
        try {
          do {
            again = false;
            const snap = await opts.snapshot();
            if (force || snap.cursor !== lastCursor) {
              lastCursor = snap.cursor;
              write(`id: ${snap.cursor}\nevent: snapshot\ndata: ${jsonText(snap.data)}\n\n`);
            }
          } while (again && !closed);
        } catch (err) {
          log.warn({ err: String(err), channel: opts.channel }, "sse snapshot failed");
          write(`event: problem\ndata: ${jsonText({ message: "Couldn't refresh; retrying." })}\n\n`);
        } finally {
          sending = false;
        }
      };

      write("retry: 2000\n\n");
      await push(true);
      unsubscribe = await subscribe(opts.channel, () => void push());

      // Kora's webhooks and NOTIFY push changes immediately; these timers are only a safety net, kept
      // slow on purpose: every open page used to cost ~20 queries every 5 s and exhausted a free
      // database plan in days.
      const inProcessWorker = !process.env.VERCEL;
      timers.push(
        setInterval(() => void push(), SAFETY_RECHECK_MS),
        ...(inProcessWorker
          ? []
          : [setInterval(() => void tick().catch((err: unknown) => log.warn({ err: String(err) }, "stream-driven tick failed")), STREAM_TICK_MS)]),
        setInterval(() => write(`: keep-alive ${Date.now()}\n\n`), 15_000),
      );
    },
    cancel() {
      closed = true;
      for (const t of timers) clearInterval(t);
      unsubscribe?.();
    },
  });

  opts.req.signal.addEventListener("abort", () => {
    closed = true;
    for (const t of timers) clearInterval(t);
    unsubscribe?.();
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      ...(env().DEMO_MODE ? { "X-ProcureAI-Demo": "1" } : {}),
    },
  });
}
