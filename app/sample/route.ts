import { db } from "@/lib/db";
import { signRecordId } from "@/lib/crypto";
import { getSetting } from "@/lib/domain/settings";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /sample — opens ONE fixed completed record (the one pinned in admin), so everyone who clicks
 * "See a completed record" sees the same, deliberate example rather than whoever finished last.
 * Until one is pinned (or if it isn't complete), the newest completed DEMO purchase is used. A real
 * customer's record is never picked automatically: it names the buyer and the vendors, and only the
 * people in that purchase hold its link. With nothing to show, the real site sends visitors to the
 * demo site's sample, and otherwise to /buy.
 */
export async function GET(): Promise<Response> {
  const e = env();
  const base = e.APP_BASE_URL.replace(/\/+$/, "");
  const pinnedId = await getSetting("sampleOrderId");
  const pinned = pinnedId ? await db().order.findFirst({ where: { id: pinnedId, status: "COMPLETE" }, select: { id: true } }) : null;
  const order =
    pinned ?? (await db().order.findFirst({ where: { status: "COMPLETE", request: { isDemo: true } }, orderBy: { updatedAt: "desc" }, select: { id: true } }));
  if (!order && !e.DEMO_MODE && /^https:\/\/[a-z0-9.-]+$/i.test(e.DEMO_SITE_URL)) {
    return new Response(null, { status: 307, headers: { Location: `${e.DEMO_SITE_URL}/sample` } });
  }
  const target = order ? `/r/${signRecordId(order.id)}` : "/buy";
  return new Response(null, { status: 303, headers: { Location: `${base}${target}` } });
}
