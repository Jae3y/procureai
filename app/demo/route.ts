import { db } from "@/lib/db";
import { DEMO_BUYER, DEMO_REQUEST_TEXT } from "@/lib/demo/script";
import { getSetting } from "@/lib/domain/settings";
import { env } from "@/lib/env";
import { buyerSessionCookie, isAdmin } from "@/lib/http/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /demo — DEMO_MODE only. Signs the presenter in as the demo buyer and opens the request that
 * `npm run demo:reset` prepared (or a blank request screen with ?fresh=1).
 * On a shared deployment (ADMIN_TOKEN set), a visitor who isn't the admin gets a buyer of their own
 * and a fresh request screen with the demo sentence filled in, so visitors never share an order.
 */
export async function GET(req: Request): Promise<Response> {
  const e = env();
  if (!e.DEMO_MODE) return new Response("Demo mode is off.", { status: 404 });
  const url = new URL(req.url);
  if (e.ADMIN_TOKEN && !isAdmin(req)) {
    const own = await db().buyer.create({ data: { ...DEMO_BUYER } });
    const headers = new Headers({ Location: new URL(`/buy?text=${encodeURIComponent(DEMO_REQUEST_TEXT)}`, e.APP_BASE_URL).toString() });
    headers.append("Set-Cookie", buyerSessionCookie(own.id));
    return new Response(null, { status: 303, headers });
  }
  const buyer =
    (await db().buyer.findFirst({ where: { email: DEMO_BUYER.email }, orderBy: { createdAt: "asc" } })) ?? (await db().buyer.create({ data: { ...DEMO_BUYER } }));
  const requestId = await getSetting("currentDemoRequestId");
  const target = url.searchParams.get("fresh") || !requestId ? "/buy" : `/buy/${requestId}`;
  const headers = new Headers({ Location: new URL(target, e.APP_BASE_URL).toString() });
  headers.append("Set-Cookie", buyerSessionCookie(buyer.id));
  return new Response(null, { status: 303, headers });
}
