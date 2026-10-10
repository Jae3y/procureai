import { databaseUrl } from "@/lib/database-url";
import { EventEmitter } from "node:events";
import pg from "pg";
import { log } from "@/lib/log";

/**
 * One Postgres LISTEN connection per process. Inserting an OrderEvent/RequestEvent fires
 * pg_notify('procureai_timeline', 'order:<id>' | 'request:<id>') (see the invariants migration),
 * which this fans out to every open SSE stream for that order/request — across processes, so a
 * webhook handled by one instance updates a tracker streamed by another.
 */

type Channel = `order:${string}` | `request:${string}`;

const g = globalThis as unknown as { procureaiBus?: { emitter: EventEmitter; client: pg.Client | null; connecting: Promise<void> | null } };

function bus() {
  if (!g.procureaiBus) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(0);
    g.procureaiBus = { emitter, client: null, connecting: null };
  }
  return g.procureaiBus;
}

async function ensureConnected(): Promise<void> {
  const b = bus();
  if (b.client) return;
  if (b.connecting) return b.connecting;
  b.connecting = (async () => {
    const client = new pg.Client({ connectionString: databaseUrl() });
    client.on("notification", (msg) => {
      if (msg.payload) b.emitter.emit(msg.payload, msg.payload);
    });
    client.on("error", (err) => {
      log.warn({ err: err.message }, "realtime listener dropped; streams fall back to periodic checks until it reconnects");
      b.client = null;
      client.end().catch((endErr: unknown) => log.debug({ err: String(endErr) }, "listener close after error"));
    });
    await client.connect();
    await client.query("LISTEN procureai_timeline");
    b.client = client;
  })().finally(() => {
    b.connecting = null;
  });
  return b.connecting;
}

/** Subscribe to one order's or request's timeline. Returns an unsubscribe function. */
export async function subscribe(channel: Channel, onChange: () => void): Promise<() => void> {
  const b = bus();
  b.emitter.on(channel, onChange);
  try {
    await ensureConnected();
  } catch (err) {
    log.warn({ err: String(err) }, "realtime listener unavailable; stream will use periodic checks");
  }
  return () => {
    b.emitter.off(channel, onChange);
  };
}
