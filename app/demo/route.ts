import { db } from "@/lib/db";
import { DEMO_BUYER } from "@/lib/demo/script";
import { getSetting } from "@/lib/domain/settings";
import { env } from "@/lib/env";
import { buyerSessionCookie } from "@/lib/http/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /demo — DEMO_MODE only. Signs the presenter in as the demo buyer and opens the request that
 * `npm run demo:reset` prepared (or a blank request screen with ?fresh=1).
 */
export async function GET(req: Request): Promise<Response> {
  const e = env();
  if (!e.DEMO_MODE) return new Response("Demo mode is off.", { status: 404 });
  const url = new URL(req.url);
  const buyer = (await db().buyer.findFirst({ where: { email: DEMO_BUYER.email } })) ?? (await db().buyer.create({ data: { ...DEMO_BUYER } }));
  const requestId = await getSetting("currentDemoRequestId");
  const target = url.searchParams.get("fresh") || !requestId ? "/buy" : `/buy/${requestId}`;
  const headers = new Headers({ Location: new URL(target, e.APP_BASE_URL).toString() });
  headers.append("Set-Cookie", buyerSessionCookie(buyer.id));
  return new Response(null, { status: 303, headers });
}
