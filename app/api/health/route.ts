import { db } from "@/lib/db";
import { env, EnvError } from "@/lib/env";
import { kora } from "@/lib/kora/client";
import { isKoraError } from "@/lib/kora/errors";
import { json } from "@/lib/http/route";
import { formatNaira } from "@/lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/health — DB, Kora reachability + balance, outbox depth. 503 only when the DB is down. */
export async function GET(): Promise<Response> {
  const started = performance.now();
  const out: Record<string, unknown> = {};
  let ok = true;

  try {
    await db().$queryRaw`SELECT 1`;
    const [pending, parked, oldest] = await Promise.all([
      db().outbox.count({ where: { doneAt: null } }),
      db().outbox.count({ where: { doneAt: { not: null }, lastError: { not: null } } }),
      db().outbox.findFirst({ where: { doneAt: null }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    ]);
    out.db = { ok: true };
    out.outbox = { pending, parked, oldestPendingSeconds: oldest ? Math.round((Date.now() - oldest.createdAt.getTime()) / 1000) : 0 };
  } catch (err) {
    ok = false;
    out.db = { ok: false, error: err instanceof Error ? err.message.slice(0, 200) : String(err) };
  }

  try {
    const e = env();
    const t = performance.now();
    const b = await kora().getBalances();
    out.kora = {
      ok: true,
      mode: e.koraMode,
      latencyMs: Math.round(performance.now() - t),
      available: b.data.NGN ? formatNaira(b.data.NGN.available_balance) : null,
      pending: b.data.NGN ? formatNaira(b.data.NGN.pending_balance) : null,
      simulateIdentity: e.SIMULATE_IDENTITY,
    };
    out.ai = { enabled: Boolean(e.AI_API_KEY), model: e.AI_MODEL };
  } catch (err) {
    if (err instanceof EnvError) out.kora = { ok: false, error: "environment not configured", problems: err.problems };
    else if (isKoraError(err)) out.kora = { ok: false, error: err.userMessage, kind: err.kind };
    else throw err;
  }

  out.latencyMs = Math.round(performance.now() - started);
  return json({ status: ok ? "ok" : "down", ...out }, ok ? 200 : 503);
}
