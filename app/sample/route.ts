import { db } from "@/lib/db";
import { signRecordId } from "@/lib/crypto";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /sample — opens the newest completed purchase's shareable record, so the landing page can link
 * to a real one without a signed URL living in the source. With none yet, it falls back to /buy.
 */
export async function GET(): Promise<Response> {
  const base = env().APP_BASE_URL.replace(/\/+$/, "");
  const order = await db().order.findFirst({ where: { status: "COMPLETE" }, orderBy: { updatedAt: "desc" }, select: { id: true } });
  const target = order ? `/r/${signRecordId(order.id)}` : "/buy";
  return new Response(null, { status: 303, headers: { Location: `${base}${target}` } });
}
