import { googleEnabled, startGoogleSignIn } from "@/lib/auth/google";
import { safeNext } from "@/lib/http/next-path";
import { rateLimit } from "@/lib/http/rate-limit";
import { clientIp, oauthStateCookie } from "@/lib/http/session";
import { env } from "@/lib/env";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/auth/google/start?next=/path — sends the browser to Google's account chooser. */
export async function GET(req: Request): Promise<Response> {
  const base = env().APP_BASE_URL;
  if (!googleEnabled()) return Response.redirect(`${base}/login?error=google_off`, 303);
  try {
    await rateLimit(`google-start:${clientIp(req)}`, 30, 600);
  } catch (limited) {
    log.warn({ err: String(limited) }, "google sign-in start rate limited");
    return Response.redirect(`${base}/login?error=too_many`, 303);
  }
  const next = safeNext(new URL(req.url).searchParams.get("next"), "/account");
  const s = startGoogleSignIn();
  const headers = new Headers({ Location: s.url, "Cache-Control": "no-store" });
  headers.append("Set-Cookie", oauthStateCookie({ state: s.state, nonce: s.nonce, verifier: s.verifier, next }));
  return new Response(null, { status: 303, headers });
}
