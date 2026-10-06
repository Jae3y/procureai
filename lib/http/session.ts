import { safeEqual, signSession, verifySession } from "@/lib/crypto";
import { db } from "@/lib/db";
import { DomainError } from "@/lib/domain/errors";
import { adminOpenToAll, env } from "@/lib/env";

/**
 * Sessions are signed cookie values (HMAC, HKDF-separated keys). The buyer has no password: the
 * session cookie is set when they create their first request (or, in DEMO_MODE, on first visit).
 * Admin: open in DEMO_MODE without an ADMIN_TOKEN; otherwise ADMIN_TOKEN, exchanged once for a signed cookie.
 */

export const BUYER_COOKIE = "pa_buyer";
export const ADMIN_COOKIE = "pa_admin";
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

export function buyerIdFrom(req: Request): string | null {
  return verifySession("buyer-session", readCookie(req, BUYER_COOKIE));
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
  const buyerId = buyerIdFrom(req);
  const request = await db().request.findUnique({ where: { id: requestId }, select: { buyerId: true } });
  if (!request) throw new DomainError("not_found", "Request was not found.", 404);
  if (!isAdmin(req) && request.buyerId !== buyerId) throw new DomainError("forbidden", "This isn't your request.", 403);
  return request.buyerId;
}

export async function requireBuyerOfOrder(req: Request, orderId: string): Promise<string> {
  const order = await db().order.findUnique({ where: { id: orderId }, select: { request: { select: { buyerId: true } } } });
  if (!order) throw new DomainError("not_found", "Order was not found.", 404);
  if (!isAdmin(req) && order.request.buyerId !== buyerIdFrom(req)) throw new DomainError("forbidden", "This isn't your order.", 403);
  return order.request.buyerId;
}

export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}
