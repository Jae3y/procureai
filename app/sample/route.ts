import { db } from "@/lib/db";
import { signRecordId } from "@/lib/crypto";
import { getSetting } from "@/lib/domain/settings";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /sample — opens ONE fixed completed record (the one pinned in admin), so everyone who clicks
 * "See a completed record" sees the same, deliberate example rather than whoever finished last.
 * Until one is pinned (or if it isn't complete), the newest completed purchase is used; with none, /buy.
 */
export async function GET(): Promise<Response> {
  const base = env().APP_BASE_URL.replace(/\/+$/, "");
  const pinnedId = await getSetting("sampleOrderId");
  const pinned = pinnedId ? await db().order.findFirst({ where: { id: pinnedId, status: "COMPLETE" }, select: { id: true } }) : null;
  const order = pinned ?? (await db().order.findFirst({ where: { status: "COMPLETE" }, orderBy: { updatedAt: "desc" }, select: { id: true } }));
  const target = order ? `/r/${signRecordId(order.id)}` : "/buy";
  return new Response(null, { status: 303, headers: { Location: `${base}${target}` } });
}
