import { db } from "@/lib/db";
import { reconcileCharge } from "@/lib/domain/payin";
import { reconcilePayout } from "@/lib/domain/payouts";
import { Empty, route } from "@/lib/http/route";
import { requireBuyerOfOrder } from "@/lib/http/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/orders/:id/recheck — "Re-check with Kora". Asks Kora about the open charge and any
 * pending payouts through exactly the code path the webhook worker and the poller use.
 */
export const POST = route<undefined, { id: string }>(
  { name: "orders.recheck", input: Empty, limits: ({ params }) => [{ key: `recheck:${params.id}`, limit: 12, windowSeconds: 60 }] },
  async ({ params, req }) => {
    const buyerId = await requireBuyerOfOrder(req, params.id);
    const cause = { type: "USER" as const, id: `recheck:${buyerId}` };
    const [payIns, payouts] = await Promise.all([
      db().payIn.findMany({ where: { orderId: params.id, status: "PROCESSING" } }),
      db().payout.findMany({ where: { orderId: params.id, status: "PENDING" } }),
    ]);
    const results: Array<{ reference: string; changed: boolean }> = [];
    for (const p of payIns) results.push({ reference: p.reference, changed: (await reconcileCharge(p.reference, cause)).changed });
    for (const p of payouts) results.push({ reference: p.reference, changed: (await reconcilePayout(p.reference, cause)).changed });
    return { body: { checked: results } };
  },
);
