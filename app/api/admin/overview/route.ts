import { route } from "@/lib/http/route";
import { requireAdmin } from "@/lib/http/session";
import { buildAdminView } from "@/lib/views/admin-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route({ name: "admin.overview" }, async ({ req }) => {
  requireAdmin(req);
  return { body: await buildAdminView() };
});
