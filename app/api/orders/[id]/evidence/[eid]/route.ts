import { db } from "@/lib/db";
import { DomainError } from "@/lib/domain/errors";
import { orderIdForVendorToken } from "@/lib/domain/messages";
import { errorReply } from "@/lib/http/idempotency";
import { json } from "@/lib/http/route";
import { requireBuyerOfOrder } from "@/lib/http/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/orders/:id/evidence/:eid[?t=<vendor token>] — one evidence photo, for the order's buyer,
 * its chosen vendor (by their link) or an admin. Never cached by shared caches.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string; eid: string }> }): Promise<Response> {
  const { id, eid } = await ctx.params;
  try {
    const token = new URL(req.url).searchParams.get("t");
    if (token) {
      if ((await orderIdForVendorToken(token)) !== id) throw new DomainError("forbidden", "This isn't your order.", 403);
    } else {
      await requireBuyerOfOrder(req, id);
    }
    if (!/^\d{1,18}$/.test(eid)) throw new DomainError("not_found", "Photo was not found.", 404);
    const ev = await db().orderEvidence.findFirst({ where: { id: BigInt(eid), orderId: id }, select: { photo: true, photoType: true } });
    if (!ev?.photo || !ev.photoType) throw new DomainError("not_found", "Photo was not found.", 404);
    return new Response(Buffer.from(ev.photo), {
      headers: { "Content-Type": ev.photoType, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" },
    });
  } catch (err) {
    const r = errorReply(err);
    return json(r.body, r.status);
  }
}
