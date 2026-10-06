import { errorReply } from "@/lib/http/idempotency";
import { json } from "@/lib/http/route";
import { isAdmin, requireBuyerOfOrder } from "@/lib/http/session";
import { sseResponse } from "@/lib/http/sse";
import { buildOrderView } from "@/lib/views/order-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** GET /api/orders/:id/stream — the tracker's live feed (SSE, full snapshots, backfill on reconnect). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  try {
    await requireBuyerOfOrder(req, id);
  } catch (err) {
    const r = errorReply(err);
    return json(r.body, r.status);
  }
  const audience = isAdmin(req) ? "admin" : "buyer";
  return sseResponse({
    req,
    channel: `order:${id}`,
    snapshot: async () => {
      const view = await buildOrderView(id, audience);
      return { cursor: `${view.lastEventId}:${view.status}`, data: view };
    },
  });
}
