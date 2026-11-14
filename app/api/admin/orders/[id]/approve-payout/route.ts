import { approveLargePayout } from "@/lib/domain/payouts";
import { Empty, route } from "@/lib/http/route";
import { requireAdmin } from "@/lib/http/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/admin/orders/:id/approve-payout — the owner approves a large order's first payout. */
export const POST = route<undefined, { id: string }>({ name: "admin.approve-payout", input: Empty }, async ({ params, req }) => {
  requireAdmin(req);
  const r = await approveLargePayout(params.id, { type: "ADMIN", id: "owner" });
  return { body: { result: r.kind, ...(r.kind === "blocked" ? { message: r.message } : {}) } };
});
