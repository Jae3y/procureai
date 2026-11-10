import { z } from "zod";
import { approve } from "@/lib/domain/approve";
import { route } from "@/lib/http/route";
import { DomainError } from "@/lib/domain/errors";
import { emailEnabled } from "@/lib/notify/email";
import { accountFrom, requireBuyerOfRequest } from "@/lib/http/session";

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
    // Once email works, a real purchase needs a confirmed address: receipts and payment alerts must reach the buyer.
    const account = await accountFrom(req);
    if (account && account.buyerId === buyerId && emailEnabled() && !account.emailVerifiedAt) {
      throw new DomainError("email_unconfirmed", "Confirm your email before paying. We sent you a link; you can send it again from your account page.", 403);
    }
    const order = await approve(params.id, input.quoteId ?? null, { type: "USER", id: buyerId });
    return { status: 201, body: { orderId: order.id, status: order.status } };
  },
);
