import { route } from "@/lib/http/route";
import { requireAdmin } from "@/lib/http/session";
import { buildReconcileView } from "@/lib/views/reconcile-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/reconcile — Kora's balance history joined to ProcureAI's ledger. */
export const GET = route({ name: "admin.reconcile" }, async ({ req }) => {
  requireAdmin(req);
  return { body: await buildReconcileView() };
});
