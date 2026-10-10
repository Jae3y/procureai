import { z } from "zod";
import { corruptSignature, payAccount, recheckNow, replayWebhook, retryStage, setPayoutRoute, suppressNextWebhook, underpay } from "@/lib/demo/actions";
import { koraHealth, latestReplayableEvent, prepareShowcase, resetDemo } from "@/lib/demo/presenter";
import { db } from "@/lib/db";
import { setSetting } from "@/lib/domain/settings";
import { DomainError } from "@/lib/domain/errors";
import { runAfterResponse } from "@/lib/http/after";
import { env } from "@/lib/env";
import { route } from "@/lib/http/route";
import { requireAdmin, requireBuyerOfOrder } from "@/lib/http/session";
import { formatNaira } from "@/lib/money";
import { tick } from "@/lib/worker/tick";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // "showcase" drives three real sandbox purchases after responding

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pay"), orderId: z.string().min(1) }),
  z.object({ action: z.literal("underpay"), orderId: z.string().min(1) }),
  z.object({ action: z.literal("route"), route: z.enum(["VERIFIED_ACCOUNT", "SANDBOX_SUCCESS_033", "SANDBOX_FAIL_035"]) }),
  z.object({ action: z.literal("suppress") }),
  z.object({ action: z.literal("replay"), eventId: z.string().min(1) }),
  z.object({ action: z.literal("corrupt"), eventId: z.string().min(1) }),
  z.object({ action: z.literal("recheck"), orderId: z.string().min(1) }),
  z.object({ action: z.literal("retry-stage"), orderId: z.string().min(1) }),
  z.object({ action: z.literal("tick") }),
  z.object({ action: z.literal("reset"), scenario: z.enum(["full", "short"]) }),
  z.object({ action: z.literal("showcase") }),
  z.object({ action: z.literal("pin-sample"), orderId: z.string().min(1) }),
  z.object({ action: z.literal("health") }),
  z.object({ action: z.literal("replay-latest") }),
  z.object({ action: z.literal("corrupt-latest") }),
]);

/** The sandbox buttons on an order page; its buyer may press them. Everything else is admin-only. */
const BUYER_ACTIONS = new Set(["pay", "underpay", "recheck"]);

/** POST /api/admin/demo — demo controls (DEMO_MODE only). Every one goes through real code paths. */
export const POST = route<z.output<typeof Body>>({ name: "admin.demo", input: Body, limits: ({ ip }) => [{ key: `demo:${ip}`, limit: 30, windowSeconds: 60 }] }, async ({ req, input }) => {
  if ("orderId" in input && BUYER_ACTIONS.has(input.action)) await requireBuyerOfOrder(req, input.orderId);
  else requireAdmin(req);
  if (!env().DEMO_MODE) throw new DomainError("demo_off", "Demo controls are off (DEMO_MODE=false).", 403);
  switch (input.action) {
    case "pay": {
      const r = await payAccount(input.orderId);
      return { body: { message: `Kora sandbox credited ${formatNaira(r.credited)} to ${r.account}.` } };
    }
    case "underpay": {
      const r = await underpay(input.orderId);
      return { body: { message: `Kora sandbox credited ${formatNaira(r.credited)} (short) to ${r.account}.` } };
    }
    case "route":
      await setPayoutRoute(input.route);
      return { body: { message: `Next payout goes to: ${input.route === "VERIFIED_ACCOUNT" ? "the verified account" : input.route === "SANDBOX_FAIL_035" ? "Kora's failing test account 035/0000000000" : "Kora's succeeding test account 033/0000000000"}.` } };
    case "suppress":
      await suppressNextWebhook();
      return { body: { message: "The next webhook will be stored but not acted on." } };
    case "replay": {
      const r = await replayWebhook(input.eventId);
      return { body: { message: r.duplicate ? "Replayed: recognised as a duplicate, nothing changed." : `Replayed: ${r.note}.` } };
    }
    case "corrupt": {
      const r = await corruptSignature(input.eventId);
      return { body: { message: r.signatureValid ? "Unexpected: signature still valid." : "Delivered with a corrupted signature: stored in red, nothing changed." } };
    }
    case "recheck":
      await recheckNow(input.orderId);
      return { body: { message: "Asked Kora about this order." } };
    case "retry-stage": {
      const r = await retryStage(input.orderId);
      return { body: { message: r.kind === "blocked" ? r.message : `Stage dispatch: ${r.kind}.` } };
    }
    case "reset": {
      const r = await resetDemo(input.scenario);
      return { body: { message: `Demo reset: "${r.text}". Replies are in; open /demo. (${r.cancelled} earlier demo request${r.cancelled === 1 ? "" : "s"} cancelled.)` } };
    }
    case "pin-sample": {
      const order = await db().order.findUnique({ where: { id: input.orderId }, select: { status: true, number: true } });
      if (!order) throw new DomainError("not_found", "No such order.", 404);
      if (order.status !== "COMPLETE") throw new DomainError("not_complete", "Only a completed purchase can be the sample record.", 409);
      await setSetting("sampleOrderId", input.orderId);
      return { body: { message: `PA-${String(order.number).padStart(4, "0")} is now the sample record behind "See a completed record".` } };
    }
    case "showcase":
      runAfterResponse("presenter-showcase", prepareShowcase);
      return { body: { message: "Preparing 3 orders (waiting for payment, held, complete) with real sandbox calls. Takes about 2 minutes; press Refresh." } };
    case "health":
      return { body: { message: await koraHealth() } };
    case "replay-latest":
    case "corrupt-latest": {
      const eventId = await latestReplayableEvent();
      if (!eventId) throw new DomainError("no_webhook", "No signed Kora webhook has arrived yet. Pay an order first.", 409);
      if (input.action === "replay-latest") {
        const r = await replayWebhook(eventId);
        return { body: { message: r.duplicate ? "Duplicate webhook: recognised, nothing changed." : `Replayed: ${r.note}.` } };
      }
      const r = await corruptSignature(eventId);
      return { body: { message: r.signatureValid ? "Unexpected: signature still valid." : "Invalid signature: stored in red, nothing changed." } };
    }
    case "tick": {
      const r = await tick();
      return { body: { message: `Tick: ${r.outbox.processed} events processed, ${r.poll.charges} charges and ${r.poll.payouts} payouts re-checked.` } };
    }
  }
});
