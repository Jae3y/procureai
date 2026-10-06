import { retryPayout } from "@/lib/domain/payouts";
import { Empty, route } from "@/lib/http/route";
import { requireBuyerOfOrder } from "@/lib/http/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/orders/:id/payouts/retry — retries a FAILED payout under a NEW reference (retryOfId links them). */
export const POST = route<undefined, { id: string }>(
  { name: "orders.retry", input: Empty, idempotent: true, limits: ({ params }) => [{ key: `retry:${params.id}`, limit: 6, windowSeconds: 300 }] },
  async ({ params, req }) => {
    const buyerId = await requireBuyerOfOrder(req, params.id);
    const r = await retryPayout(params.id, { type: "USER", id: buyerId });
    if (r.kind === "blocked") return { status: 409, body: { error: { code: r.reason, message: r.message } } };
    return { body: { result: r.kind, reference: "payout" in r ? r.payout.reference : null } };
  },
);
