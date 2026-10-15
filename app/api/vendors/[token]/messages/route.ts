import { z } from "zod";
import { MESSAGE_MAX_CHARS, orderIdForVendorToken, postMessage } from "@/lib/domain/messages";
import { route } from "@/lib/http/route";
import { buildThreadView } from "@/lib/views/thread-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ text: z.string().min(1).max(MESSAGE_MAX_CHARS * 2) });

/** GET /api/vendors/:token/messages[?after=<id>] — the chosen vendor's view of the thread, by invite link. */
export const GET = route<undefined, { token: string }>({ name: "vendors.messages.get" }, async ({ params, req }) => {
  const orderId = await orderIdForVendorToken(params.token);
  return { body: await buildThreadView(orderId, "vendor", new URL(req.url).searchParams.get("after")) };
});

/** POST /api/vendors/:token/messages — the vendor writes to the buyer. */
export const POST = route<z.output<typeof Body>, { token: string }>(
  { name: "vendors.messages.post", input: Body, limits: ({ params }) => [{ key: `msg-v:${params.token.slice(0, 12)}`, limit: 20, windowSeconds: 60 }] },
  async ({ params, req, input }) => {
    const orderId = await orderIdForVendorToken(params.token);
    await postMessage(orderId, "VENDOR", input.text);
    return { status: 201, body: await buildThreadView(orderId, "vendor", new URL(req.url).searchParams.get("after")) };
  },
);
