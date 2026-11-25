import { attributionFrom, signupEventCookie } from "@/lib/attribution";
import { exchangeGoogleCode, GoogleSignInError, googleEnabled, verifyGoogleIdToken } from "@/lib/auth/google";
import { safeEqual } from "@/lib/crypto";
import { completeLogin, googleSignIn } from "@/lib/domain/accounts";
import { DomainError } from "@/lib/domain/errors";
import { env } from "@/lib/env";
import { rateLimit } from "@/lib/http/rate-limit";
import { accountSessionCookie, clearLoginTicketCookie, clearOauthCookie, clientIp, loginTicketCookie, oauthStateFrom } from "@/lib/http/session";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function go(path: string, cookies: string[]): Response {
  const headers = new Headers({ Location: `${env().APP_BASE_URL}${path}`, "Cache-Control": "no-store" });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(null, { status: 303, headers });
}

/** GET /api/auth/google/callback — Google sends the browser back here with a one-time code. */
export async function GET(req: Request): Promise<Response> {
  const clear = clearOauthCookie();
  if (!googleEnabled()) return go("/login?error=google_off", [clear]);
  const url = new URL(req.url);
  const saved = oauthStateFrom(req);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code");
  if (url.searchParams.get("error")) return go("/login?error=google_cancelled", [clear]);
  if (!saved || !code || !state || !safeEqual(state, saved.state)) return go("/login?error=google_expired", [clear]);
  let signupFlag: string[] = [];
  try {
    await rateLimit(`google-callback:${clientIp(req)}`, 30, 600);
    const idToken = await exchangeGoogleCode(code, saved.verifier);
    const profile = await verifyGoogleIdToken(idToken, { nonce: saved.nonce });
    const { account, created } = await googleSignIn(profile, attributionFrom(req));
    // This call opened the account: the next page fires GA's sign_up event once, even if finishing the login fails below.
    if (created) signupFlag = [signupEventCookie("google", env().APP_BASE_URL.startsWith("https://"))];
    if (account.totpEnabledAt) {
      // Google proves who you are; two-step sign-in, once switched on, is still asked for.
      return go(`/login?step=code&next=${encodeURIComponent(saved.next)}`, [clear, loginTicketCookie(account.id), ...signupFlag]);
    }
    const signedIn = await completeLogin(account, { ip: clientIp(req), userAgent: req.headers.get("user-agent") });
    return go(saved.next, [clear, accountSessionCookie(signedIn), clearLoginTicketCookie(), ...signupFlag]);
  } catch (err) {
    if (err instanceof GoogleSignInError) {
      log.warn({ reason: err.reason }, "google sign-in refused");
      return go("/login?error=google_failed", [clear, ...signupFlag]);
    }
    if (err instanceof DomainError) {
      log.warn({ code: err.code }, "google sign-in refused by a domain rule");
      return go(`/login?error=${err.code === "rate_limited" ? "too_many" : err.code === "google_mismatch" ? "google_mismatch" : "google_failed"}`, [clear, ...signupFlag]);
    }
    log.error({ err }, "google sign-in failed");
    return go("/login?error=google_failed", [clear, ...signupFlag]);
  }
}
