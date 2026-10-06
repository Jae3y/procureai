import { refundOrder } from "@/lib/domain/refunds";
import { Empty, route } from "@/lib/http/route";
import { requireAdmin } from "@/lib/http/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/orders/:id/refund — admin returns the held money of a disputed order through Kora. */
export const POST = route<undefined, { id: string }>({ name: "orders.refund", input: Empty, idempotent: true }, async ({ params, req }) => {
  requireAdmin(req);
  const r = await refundOrder(params.id, { type: "ADMIN", id: "admin" });
  return { body: r };
});
