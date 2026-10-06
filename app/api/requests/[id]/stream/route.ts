import { errorReply } from "@/lib/http/idempotency";
import { json } from "@/lib/http/route";
import { isAdmin, requireBuyerOfRequest } from "@/lib/http/session";
import { sseResponse } from "@/lib/http/sse";
import { buildRequestView } from "@/lib/views/request-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** GET /api/requests/:id/stream — live quotes, Kora checks and recommendation (SSE). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  try {
    await requireBuyerOfRequest(req, id);
  } catch (err) {
    const r = errorReply(err);
    return json(r.body, r.status);
  }
  const includeInvites = isAdmin(req);
  return sseResponse({
    req,
    channel: `request:${id}`,
    snapshot: async () => {
      const view = await buildRequestView(id, { includeInvites });
      return { cursor: `${view.lastEventId}:${view.status}:${view.repliedCount}`, data: view };
    },
  });
}
