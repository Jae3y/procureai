import { route } from "@/lib/http/route";
import { isAdmin, requireBuyerOfOrder } from "@/lib/http/session";
import { buildOrderView } from "@/lib/views/order-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route<undefined, { id: string }>({ name: "orders.get" }, async ({ params, req }) => {
  await requireBuyerOfOrder(req, params.id);
  return { body: await buildOrderView(params.id, isAdmin(req) ? "admin" : "buyer") };
});
