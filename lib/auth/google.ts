import { createHash, createPublicKey, type JsonWebKey, randomBytes, verify as verifySignature } from "node:crypto";
import { env } from "@/lib/env";

/**
 * "Continue with Google" (OpenID Connect, authorization-code flow with PKCE).
 *
 *   start:    random state + nonce + PKCE verifier, kept in a short signed cookie; the browser goes to Google.
 *   callback: the state must match the cookie; the code is exchanged server-to-server (with the
 *             verifier); the returned ID token's RS256 signature is checked against Google's published
 *             keys, and its issuer, audience, expiry, nonce and email_verified claims are all enforced.
 */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const CLOCK_SKEW_S = 60;

export function googleEnabled(): boolean {
  const e = env();
  return Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET);
}

export function googleRedirectUri(): string {
  return `${env().APP_BASE_URL.replace(/\/+$/, "")}/api/auth/google/callback`;
}

export type OAuthStart = { state: string; nonce: string; verifier: string; url: string };

export function startGoogleSignIn(): OAuthStart {
  const state = randomBytes(24).toString("base64url");
  const nonce = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const params = new URLSearchParams({
    client_id: env().GOOGLE_CLIENT_ID,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return { state, nonce, verifier, url: `${AUTH_URL}?${params.toString()}` };
}

export class GoogleSignInError extends Error {
  constructor(readonly reason: string) {
    super(`Google sign-in refused: ${reason}`);
    this.name = "GoogleSignInError";
  }
}

/** Code → ID token, server to server. */
export async function exchangeGoogleCode(code: string, verifier: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const e = env();
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: e.GOOGLE_CLIENT_ID,
      client_secret: e.GOOGLE_CLIENT_SECRET,
      redirect_uri: googleRedirectUri(),
      grant_type: "authorization_code",
      code_verifier: verifier,
    }).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new GoogleSignInError(`token endpoint answered ${res.status}`);
  const body = (await res.json()) as { id_token?: unknown };
  if (typeof body.id_token !== "string") throw new GoogleSignInError("no ID token in the response");
  return body.id_token;
}

type Jwk = JsonWebKey & { kid?: string };
let jwksCache: { at: number; keys: Jwk[] } | null = null;

async function googleKey(kid: string, fetchImpl: typeof fetch = fetch): Promise<Jwk | null> {
  const fresh = jwksCache && Date.now() - jwksCache.at < 60 * 60 * 1000;
  if (!fresh || !jwksCache?.keys.some((k) => k.kid === kid)) {
    const res = await fetchImpl(JWKS_URL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new GoogleSignInError(`Google's keys answered ${res.status}`);
    const body = (await res.json()) as { keys?: Jwk[] };
    jwksCache = { at: Date.now(), keys: body.keys ?? [] };
  }
  return jwksCache.keys.find((k) => k.kid === kid) ?? null;
}

export type GoogleProfile = { sub: string; email: string; name: string };

/**
 * Checks an ID token completely and returns who it is for. `getKey` is replaceable so tests can sign
 * their own tokens; in production it reads Google's published keys.
 */
export async function verifyGoogleIdToken(
  idToken: string,
  opts: { nonce: string; clientId?: string; nowS?: number; getKey?: (kid: string) => Promise<Jwk | null> },
): Promise<GoogleProfile> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new GoogleSignInError("malformed token");
  const [h, p, s] = parts as [string, string, string];
  let header: { alg?: string; kid?: string };
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(h, "base64url").toString("utf8")) as { alg?: string; kid?: string };
    claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch (bad) {
    throw new GoogleSignInError(`unreadable token (${String(bad)})`);
  }
  if (header.alg !== "RS256" || !header.kid) throw new GoogleSignInError("unexpected signing algorithm");
  const jwk = await (opts.getKey ?? ((kid: string) => googleKey(kid)))(header.kid);
  if (!jwk) throw new GoogleSignInError("unknown signing key");
  const ok = verifySignature("RSA-SHA256", Buffer.from(`${h}.${p}`), createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(s, "base64url"));
  if (!ok) throw new GoogleSignInError("bad signature");

  const now = opts.nowS ?? Math.floor(Date.now() / 1000);
  const clientId = opts.clientId ?? env().GOOGLE_CLIENT_ID;
  if (!ISSUERS.has(String(claims.iss))) throw new GoogleSignInError("wrong issuer");
  if (claims.aud !== clientId) throw new GoogleSignInError("token is for another app");
  if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_S < now) throw new GoogleSignInError("token expired");
  if (typeof claims.iat === "number" && claims.iat - CLOCK_SKEW_S > now) throw new GoogleSignInError("token from the future");
  if (claims.nonce !== opts.nonce) throw new GoogleSignInError("nonce mismatch");
  if (claims.email_verified !== true) throw new GoogleSignInError("Google hasn't verified this email");
  if (typeof claims.sub !== "string" || typeof claims.email !== "string") throw new GoogleSignInError("token has no subject or email");
  const name = typeof claims.name === "string" && claims.name.trim() ? claims.name.trim() : claims.email.split("@")[0] ?? "ProcureAI user";
  return { sub: claims.sub, email: claims.email.toLowerCase(), name: name.slice(0, 80) };
}
