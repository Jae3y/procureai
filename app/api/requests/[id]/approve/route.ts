import { z } from "zod";
import { approve } from "@/lib/domain/approve";
import { route } from "@/lib/http/route";
import { requireBuyerOfRequest } from "@/lib/http/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ quoteId: z.string().min(1).max(64).optional() }).optional().transform((b) => b ?? {});

/**
 * POST /api/requests/:id/approve — creates the Order and opens the one-time Kora account.
 * Send an Idempotency-Key: a double-submit returns the stored response (one order, one account).
 */
export const POST = route<{ quoteId?: string | undefined }, { id: string }>(
  { name: "requests.approve", input: Body, idempotent: true, limits: ({ params }) => [{ key: `approve:${params.id}`, limit: 10, windowSeconds: 300 }] },
  async ({ params, req, input }) => {
    const buyerId = await requireBuyerOfRequest(req, params.id);
    const order = await approve(params.id, input.quoteId ?? null, { type: "USER", id: buyerId });
    return { status: 201, body: { orderId: order.id, status: order.status } };
  },
);
