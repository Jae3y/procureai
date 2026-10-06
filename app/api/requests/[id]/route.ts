import { route } from "@/lib/http/route";
import { isAdmin, requireBuyerOfRequest } from "@/lib/http/session";
import { buildRequestView } from "@/lib/views/request-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route<undefined, { id: string }>({ name: "requests.get" }, async ({ params, req }) => {
  await requireBuyerOfRequest(req, params.id);
  return { body: await buildRequestView(params.id, { includeInvites: isAdmin(req) }) };
});
