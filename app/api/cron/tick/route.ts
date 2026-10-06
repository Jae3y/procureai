import { safeEqual } from "@/lib/crypto";
import { env } from "@/lib/env";
import { json } from "@/lib/http/route";
import { isAdmin } from "@/lib/http/session";
import { tick } from "@/lib/worker/tick";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/tick — Vercel Cron's entry point (vercel.json). Vercel sends
 * `Authorization: Bearer $CRON_SECRET`; locally the in-process loop does this instead.
 */
export async function GET(req: Request): Promise<Response> {
  const secret = env().CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  const allowed = secret ? auth.startsWith("Bearer ") && safeEqual(auth.slice(7), secret) : isAdmin(req);
  if (!allowed) return json({ error: { code: "forbidden", message: "Not allowed." } }, 403);
  const r = await tick();
  return json({ ok: true, ...r });
}
