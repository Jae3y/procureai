import { refundOrder } from "@/lib/domain/refunds";
import { z } from "zod";
import { route } from "@/lib/http/route";
import { requireAdmin } from "@/lib/http/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ purpose: z.enum(["dispute", "overpayment"]).default("dispute") }).optional().transform((b) => b ?? { purpose: "dispute" as const });

/**
 * POST /api/orders/:id/refund — admin returns held money through the payment provider: a disputed order's held
 * money ({ purpose: "dispute" }, the default), or what a buyer overpaid on a completed order ({ purpose: "overpayment" }).
 */
export const POST = route<{ purpose: "dispute" | "overpayment" }, { id: string }>({ name: "orders.refund", input: Body, idempotent: true }, async ({ params, req, input }) => {
  requireAdmin(req);
  const r = await refundOrder(params.id, { type: "ADMIN", id: "admin" }, input.purpose);
  return { body: { ...r, message: `Refund ${r.reference} sent: ${r.status}.` } };
});
