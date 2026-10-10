import { deliverScriptedReplies } from "@/lib/demo/actions";
import { inviteVendors } from "@/lib/domain/requests";
import { requestEvent } from "@/lib/domain/timeline";
import { env } from "@/lib/env";
import { runAfterResponse } from "@/lib/http/after";
import { Empty, route } from "@/lib/http/route";
import { requireBuyerOfRequest } from "@/lib/http/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // scripted replies are parsed (AI) after the response

/** POST /api/requests/:id/invite — ask the directory vendors that match the item. */
export const POST = route<undefined, { id: string }>({ name: "requests.invite", input: Empty, idempotent: true }, async ({ params, req }) => {
  await requireBuyerOfRequest(req, params.id);
  const invites = await inviteVendors(params.id);
  if (env().DEMO_MODE) {
    // Demo vendors "reply" through the same path as a real vendor's phone, a beat apart.
    runAfterResponse("demo-scripted-replies", async () => {
      await requestEvent(params.id, { kind: "info", title: "Demo vendors replying", detail: "Scripted replies, submitted through the vendor quote path" });
      await deliverScriptedReplies(params.id, { spacingMs: 1_400 });
    });
  }
  return { status: 201, body: { invited: invites.length } };
});
