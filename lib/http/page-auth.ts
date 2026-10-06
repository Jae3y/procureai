import { cookies } from "next/headers";
import { verifySession } from "@/lib/crypto";
import { db } from "@/lib/db";
import { adminOpenToAll, env } from "@/lib/env";
import { ADMIN_COOKIE, BUYER_COOKIE } from "./session";

/** Session checks for server-rendered pages (route handlers use lib/http/session.ts). */

export async function pageBuyerId(): Promise<string | null> {
  const c = await cookies();
  return verifySession("buyer-session", c.get(BUYER_COOKIE)?.value);
}

export async function pageIsAdmin(): Promise<boolean> {
  if (adminOpenToAll(env())) return true;
  const c = await cookies();
  return verifySession("admin-session", c.get(ADMIN_COOKIE)?.value) === "admin";
}

export async function pageCanSeeRequest(requestId: string): Promise<"ok" | "missing" | "forbidden"> {
  const r = await db().request.findUnique({ where: { id: requestId }, select: { buyerId: true } });
  if (!r) return "missing";
  if (await pageIsAdmin()) return "ok";
  return r.buyerId === (await pageBuyerId()) ? "ok" : "forbidden";
}

export async function pageCanSeeOrder(orderId: string): Promise<"ok" | "missing" | "forbidden"> {
  const o = await db().order.findUnique({ where: { id: orderId }, select: { request: { select: { buyerId: true } } } });
  if (!o) return "missing";
  if (await pageIsAdmin()) return "ok";
  return o.request.buyerId === (await pageBuyerId()) ? "ok" : "forbidden";
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join("");
}
