import { db } from "@/lib/db";
import { env, EnvError } from "@/lib/env";
import { kora } from "@/lib/kora/client";
import { isKoraError } from "@/lib/kora/errors";
import { json } from "@/lib/http/route";
import { isAdmin } from "@/lib/http/session";
import { formatNaira } from "@/lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health — DB, Kora reachability + balance, outbox depth. 503 only when the DB is down.
 * Anyone sees up/down per dependency; the balance, outbox and error details are for the admin only.
 */
export async function GET(req: Request): Promise<Response> {
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
  const body = adminCaller(req)
    ? { status: ok ? "ok" : "down", ...out }
    : { status: ok ? "ok" : "down", db: { ok: (out.db as { ok: boolean }).ok }, kora: { ok: Boolean((out.kora as { ok?: boolean } | undefined)?.ok) } };
  return json(body, ok ? 200 : 503);
}

/** isAdmin reads the environment; when that's misconfigured, health must still answer (as public). */
function adminCaller(req: Request): boolean {
  try {
    return isAdmin(req);
  } catch (err) {
    if (err instanceof EnvError) return false;
    throw err;
  }
}
