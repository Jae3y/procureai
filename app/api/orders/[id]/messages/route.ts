import { z } from "zod";
import { DomainError } from "@/lib/domain/errors";
import { MESSAGE_MAX_CHARS, postMessage } from "@/lib/domain/messages";
import { route } from "@/lib/http/route";
import { buyerIdFrom, isAdmin, requireBuyerOfOrder } from "@/lib/http/session";
import { buildThreadView } from "@/lib/views/thread-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ text: z.string().min(1).max(MESSAGE_MAX_CHARS * 2) });

/** GET /api/orders/:id/messages[?after=<id>] — the buyer's view of the thread with the vendor. */
export const GET = route<undefined, { id: string }>({ name: "orders.messages.get" }, async ({ params, req }) => {
  await requireBuyerOfOrder(req, params.id);
  const after = new URL(req.url).searchParams.get("after");
  return { body: await buildThreadView(params.id, isAdmin(req) && !buyerIdFrom(req) ? "admin" : "buyer", after) };
});

/** POST /api/orders/:id/messages — the buyer writes to the vendor. Only the buyer, not an admin. */
export const POST = route<z.output<typeof Body>, { id: string }>(
  { name: "orders.messages.post", input: Body, limits: ({ params }) => [{ key: `msg-b:${params.id}`, limit: 20, windowSeconds: 60 }] },
  async ({ params, req, input }) => {
    const buyerId = await requireBuyerOfOrder(req, params.id);
    if (buyerIdFrom(req) !== buyerId) throw new DomainError("forbidden", "Only the buyer can write here.", 403);
    await postMessage(params.id, "BUYER", input.text);
    return { status: 201, body: await buildThreadView(params.id, "buyer", new URL(req.url).searchParams.get("after")) };
  },
);
