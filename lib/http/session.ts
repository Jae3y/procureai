import { safeEqual, signSession, verifySession } from "@/lib/crypto";
import { db } from "@/lib/db";
import { DomainError } from "@/lib/domain/errors";
import { adminOpenToAll, env } from "@/lib/env";
import type { Account } from "@/lib/generated/prisma/client";

/**
 * Sessions are signed cookie values (HMAC, HKDF-separated keys). Two kinds of person can be a buyer:
 * someone signed in (pa_session, which names an account and its session version, so a password
 * change ends every older session) and a demo visitor (pa_buyer, no password, DEMO_MODE only).
 * One browser can hold both: signed in for real purchases while trying the demo.
 * Admin: open in DEMO_MODE without an ADMIN_TOKEN; otherwise ADMIN_TOKEN, exchanged once for a signed cookie.
 */

export const BUYER_COOKIE = "pa_buyer";
export const ADMIN_COOKIE = "pa_admin";
/** On HTTPS the browser enforces the __Host- prefix: Secure, Path=/, no Domain, so no subdomain can set or read it. */
export const ACCOUNT_COOKIE = "__Host-pa_session";
const ACCOUNT_COOKIE_PLAIN = "pa_session";
const ACCOUNT_TTL = 60 * 60 * 24 * 30;
/** Between the password and the authenticator code: proves the password step passed, for 5 minutes. */
export const LOGIN_TICKET_COOKIE = "pa_login";
const LOGIN_TICKET_TTL = 5 * 60;

export function accountCookieName(): string {
  return env().APP_BASE_URL.startsWith("https://") ? ACCOUNT_COOKIE : ACCOUNT_COOKIE_PLAIN;
}

export function loginTicketCookie(accountId: string): string {
  return cookieHeader(LOGIN_TICKET_COOKIE, signSession("login-ticket", accountId, LOGIN_TICKET_TTL), LOGIN_TICKET_TTL);
}

export function clearLoginTicketCookie(): string {
  return cookieHeader(LOGIN_TICKET_COOKIE, "", 0);
}

export const OAUTH_COOKIE = "pa_oauth";
const OAUTH_TTL = 10 * 60;

/** The OAuth state, nonce, PKCE verifier and where to go after, signed, for ten minutes. */
export function oauthStateCookie(state: { state: string; nonce: string; verifier: string; next: string }): string {
  const subject = Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
  return cookieHeader(OAUTH_COOKIE, signSession("oauth-state", subject, OAUTH_TTL), OAUTH_TTL);
}

export function clearOauthCookie(): string {
  return cookieHeader(OAUTH_COOKIE, "", 0);
}

export function oauthStateFrom(req: Request): { state: string; nonce: string; verifier: string; next: string } | null {
  const subject = verifySession("oauth-state", readCookie(req, OAUTH_COOKIE));
  if (!subject) return null;
  try {
    return JSON.parse(Buffer.from(subject, "base64url").toString("utf8")) as { state: string; nonce: string; verifier: string; next: string };
  } catch {
    return null; // a cookie we signed but can't read back is treated as no sign-in in progress
  }
}

export function loginTicketFrom(req: Request): string | null {
  return verifySession("login-ticket", readCookie(req, LOGIN_TICKET_COOKIE));
}
const BUYER_TTL = 60 * 60 * 24 * 30;
const ADMIN_TTL = 60 * 60 * 12;

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export function cookieHeader(name: string, value: string, maxAge: number): string {
  const secure = env().APP_BASE_URL.startsWith("https://") ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function buyerSessionCookie(buyerId: string): string {
  return cookieHeader(BUYER_COOKIE, signSession("buyer-session", buyerId, BUYER_TTL), BUYER_TTL);
}

export function adminSessionCookie(): string {
  return cookieHeader(ADMIN_COOKIE, signSession("admin-session", "admin", ADMIN_TTL), ADMIN_TTL);
}

export function accountSessionCookie(account: { id: string; sessionVersion: number }): string {
  return cookieHeader(accountCookieName(), signSession("account-session", `${account.id}:${account.sessionVersion}`, ACCOUNT_TTL), ACCOUNT_TTL);
}

export function clearAccountCookie(): string {
  return cookieHeader(accountCookieName(), "", 0);
}

/** The signed-in account for a raw cookie value, or null if it is missing, expired or from before a password change. */
export async function accountForCookie(value: string | undefined): Promise<Account | null> {
  const subject = verifySession("account-session", value);
  if (!subject) return null;
  const [id, version] = subject.split(":");
  if (!id || !version) return null;
  const account = await db().account.findUnique({ where: { id } });
  return account && String(account.sessionVersion) === version ? account : null;
}

export function accountFrom(req: Request): Promise<Account | null> {
  return accountForCookie(readCookie(req, accountCookieName()));
}

export async function requireAccount(req: Request): Promise<Account> {
  const account = await accountFrom(req);
  if (!account) throw new DomainError("sign_in_required", "Please sign in first.", 401);
  return account;
}

/** Every buyer this browser may act as: the signed-in account's first, then the demo visitor's. */
export async function buyerIdsFrom(req: Request): Promise<string[]> {
  const account = await accountFrom(req);
  const demo = verifySession("buyer-session", readCookie(req, BUYER_COOKIE));
  return [account?.buyerId, demo].filter((id): id is string => Boolean(id));
}

export function isAdmin(req: Request): boolean {
  const e = env();
  if (adminOpenToAll(e)) return true;
  if (verifySession("admin-session", readCookie(req, ADMIN_COOKIE)) === "admin") return true;
  const auth = req.headers.get("authorization") ?? "";
  return Boolean(e.ADMIN_TOKEN) && auth.startsWith("Bearer ") && safeEqual(auth.slice(7), e.ADMIN_TOKEN);
}

export function requireAdmin(req: Request): void {
  if (!isAdmin(req)) throw new DomainError("forbidden", "Admin access only.", 403);
}

export async function requireBuyerOfRequest(req: Request, requestId: string): Promise<string> {
  const request = await db().request.findUnique({ where: { id: requestId }, select: { buyerId: true } });
  if (!request) throw new DomainError("not_found", "Request was not found.", 404);
  if (!isAdmin(req) && !(await buyerIdsFrom(req)).includes(request.buyerId)) throw new DomainError("forbidden", "This isn't your request.", 403);
  return request.buyerId;
}

export async function requireBuyerOfOrder(req: Request, orderId: string): Promise<string> {
  const order = await db().order.findUnique({ where: { id: orderId }, select: { request: { select: { buyerId: true } } } });
  if (!order) throw new DomainError("not_found", "Order was not found.", 404);
  if (!isAdmin(req) && !(await buyerIdsFrom(req)).includes(order.request.buyerId)) throw new DomainError("forbidden", "This isn't your order.", 403);
  return order.request.buyerId;
}

export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}
