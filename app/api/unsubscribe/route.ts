import { unsubscribe } from "@/lib/notify/lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/unsubscribe?t=<signed token> — the one-click unsubscribe mail apps send (RFC 8058), and what the page's button calls.
 * A plain handler, not route(): mail providers post without an Origin header. The signed token is the proof, and it only
 * ever turns emails OFF, so there is nothing for an attacker to gain.
 */
export async function POST(req: Request): Promise<Response> {
  const ok = await unsubscribe(new URL(req.url).searchParams.get("t"));
  return Response.json(ok ? { ok: true } : { error: { code: "invalid_link", message: "This link isn't valid or has expired." } }, { status: ok ? 200 : 400 });
}
