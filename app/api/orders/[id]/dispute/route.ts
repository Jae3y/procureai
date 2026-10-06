import { z } from "zod";
import { disputeOrder } from "@/lib/domain/refunds";
import { route } from "@/lib/http/route";
import { requireBuyerOfOrder } from "@/lib/http/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ reason: z.string().trim().min(5).max(200) });

/** POST /api/orders/:id/dispute — freezes payouts while money is still held. */
export const POST = route<z.output<typeof Body>, { id: string }>({ name: "orders.dispute", input: Body, idempotent: true }, async ({ params, req, input }) => {
  const buyerId = await requireBuyerOfOrder(req, params.id);
  await disputeOrder(params.id, input.reason, { type: "USER", id: buyerId });
  return { body: { status: "DISPUTED" } };
});
