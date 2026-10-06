import { db } from "@/lib/db";
import { vendorByToken } from "@/lib/domain/vendors";
import { errorReply } from "@/lib/http/idempotency";
import { json } from "@/lib/http/route";
import { sseResponse } from "@/lib/http/sse";
import { buildVendorView } from "@/lib/views/vendor-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** GET /api/vendors/:token/stream — the vendor's phone updates live as Kora moves money. */
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await ctx.params;
  let channel: `order:${string}` | `request:${string}`;
  try {
    const vendor = await vendorByToken(token);
    const order = await db().order.findUnique({ where: { requestId: vendor.requestId }, select: { id: true, vendorId: true } });
    channel = order && order.vendorId === vendor.id ? `order:${order.id}` : `request:${vendor.requestId}`;
  } catch (err) {
    const r = errorReply(err);
    return json(r.body, r.status);
  }
  return sseResponse({
    req,
    channel,
    snapshot: async () => {
      const view = await buildVendorView(token);
      return { cursor: `${view.screen}:${view.order?.lastEventId ?? "0"}:${view.order?.status ?? ""}`, data: view };
    },
  });
}
