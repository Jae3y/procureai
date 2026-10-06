import { db, transaction } from "@/lib/db";
import { env } from "@/lib/env";
import { kora } from "@/lib/kora/client";
import { isKoraError } from "@/lib/kora/errors";
import { formatNaira, type Kobo } from "@/lib/money";
import { DomainError, NotFoundError, UnknownReferenceError } from "./errors";
import { recordApiEvent, toJson } from "./kora-events";
import { type Cause, lockOrder, transition } from "./state";
import { orderEvent } from "./timeline";

/**
 * DISPUTED → REFUNDED. A dispute freezes the order (no further payouts can dispatch: the state
 * machine has no edge out of DISPUTED except REFUNDED). The refund returns what is still HELD —
 * money already paid to the vendor in Stage 1 is not clawed back by ProcureAI.
 * Same discipline as payouts: row first (PENDING, unique reference), then Kora, never blind-retried.
 */

export async function disputeOrder(orderId: string, reason: string, cause: Cause): Promise<void> {
  await transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (order.status !== "HELD" && order.status !== "STAGE_1_PAID") {
      throw new DomainError("not_disputable", "This order can only be disputed while money is held, before delivery.", 409);
    }
    await transition(tx, order, "DISPUTED", { ...cause, note: reason.slice(0, 200) });
    await orderEvent(tx, orderId, { kind: "error", title: "Disputed", detail: `${reason.slice(0, 200)} Payouts are frozen.` });
  });
}

async function refundableKobo(orderId: string): Promise<Kobo> {
  const [ledger, pending] = await Promise.all([
    db().ledgerEntry.findMany({ where: { orderId, account: "HELD" } }),
    db().payout.findMany({ where: { orderId, status: "PENDING" } }),
  ]);
  const held = ledger.reduce((a, r) => a + (r.direction === "CREDIT" ? r.amountKobo : -r.amountKobo), 0n);
  return held - pending.reduce((a, p) => a + p.amountKobo, 0n);
}

export async function refundOrder(orderId: string, cause: Cause): Promise<{ reference: string; status: string }> {
  const order = await db().order.findUnique({ where: { id: orderId } });
  if (!order) throw new NotFoundError("Order");
  if (order.status !== "DISPUTED") throw new DomainError("not_disputed", "Only a disputed order can be refunded.", 409);
  const amountKobo = await refundableKobo(orderId);
  if (amountKobo < 10_000n) throw new DomainError("refund_too_small", "Kora refunds start at ₦100; nothing refundable is held.", 409);
  const source = await db().payIn.findFirst({ where: { orderId, status: "SUCCESS" }, orderBy: { amountAcceptedKobo: "desc" } });
  if (!source) throw new DomainError("no_payment", "There is no successful payment to refund.", 409);
  if (source.amountAcceptedKobo < amountKobo) {
    throw new DomainError("split_payment", "The held money came from more than one payment; refund each payment from the Kora dashboard.", 409);
  }

  const refund = await transaction(async (tx) => {
    const locked = await lockOrder(tx, orderId);
    if (locked.status !== "DISPUTED") return null;
    const n = (await tx.refund.count({ where: { orderId } })) + 1;
    return tx.refund.create({
      data: { orderId, paymentReference: source.reference, reference: `RF-${orderId}-${n}`, amountKobo, reason: "Disputed order: held funds returned" },
    });
  });
  if (!refund) throw new DomainError("not_disputed", "Only a disputed order can be refunded.", 409);

  try {
    const res = await kora().initiateRefund({
      reference: refund.reference,
      paymentReference: refund.paymentReference,
      amountKobo: refund.amountKobo,
      reason: refund.reason,
      webhookUrl: env().KORA_WEBHOOK_URL,
    });
    await transaction((tx) =>
      orderEvent(tx, orderId, {
        kind: "info",
        title: "Refund sent to Kora",
        detail: `${formatNaira(refund.amountKobo)} back to the buyer · ${res.data.status}`,
        amountKobo: refund.amountKobo,
        koraReference: refund.reference,
        signature: "API",
      }),
    );
    if (res.data.status === "success" || res.data.status === "failed") {
      await applyRefundOutcome(refund.reference, res.data.status, null, res.raw, cause);
    }
    return { reference: refund.reference, status: res.data.status };
  } catch (err) {
    if (!isKoraError(err)) throw err;
    if (err.outcomeKnown) {
      await applyRefundOutcome(refund.reference, "failed", err.koraMessage ?? err.userMessage, err.body ?? { error: err.toJSON() }, cause);
      throw new DomainError("refund_failed", `Kora refused the refund: ${err.koraMessage ?? err.userMessage}`, 502);
    }
    await transaction((tx) =>
      orderEvent(tx, orderId, { kind: "info", title: "Checking refund with Kora", detail: err.userMessage, koraReference: refund.reference }),
    );
    return { reference: refund.reference, status: "pending" };
  }
}

export async function applyRefundOutcome(
  reference: string,
  status: "success" | "failed" | "processing",
  message: string | null,
  raw: unknown,
  cause: Cause,
): Promise<{ changed: boolean }> {
  return transaction(async (tx) => {
    const found = await tx.refund.findUnique({ where: { reference }, select: { orderId: true } });
    if (!found) throw new UnknownReferenceError(reference);
    let order = await lockOrder(tx, found.orderId);
    const refund = await tx.refund.findUniqueOrThrow({ where: { reference } });
    if (cause.type !== "WEBHOOK") {
      await recordApiEvent(tx, { type: "refund.query", reference, orderId: order.id, raw, fingerprint: { reference, status } });
    }
    if (refund.status !== "PENDING" || status === "processing") return { changed: false };
    const signature = cause.type === "WEBHOOK" ? "VERIFIED" : "API";
    if (status === "success") {
      await tx.refund.update({ where: { id: refund.id }, data: { status: "SUCCESS", resolvedAt: new Date(), koraResponse: toJson(raw) } });
      await tx.ledgerEntry.createMany({
        data: [
          { orderId: order.id, account: "HELD", direction: "DEBIT", amountKobo: refund.amountKobo, koraReference: reference, sourceType: "REFUND", sourceId: refund.id },
          { orderId: order.id, account: "BUYER_PAYIN", direction: "CREDIT", amountKobo: refund.amountKobo, koraReference: reference, sourceType: "REFUND", sourceId: refund.id },
        ],
      });
      await orderEvent(tx, order.id, { kind: "kora", title: "refund.success", detail: "Held money returned to the buyer", amountKobo: refund.amountKobo, koraReference: reference, signature });
      if (order.status === "DISPUTED") order = await transition(tx, order, "REFUNDED", { ...cause, note: reference });
      return { changed: true };
    }
    await tx.refund.update({
      where: { id: refund.id },
      data: { status: "FAILED", resolvedAt: new Date(), failureReason: message ?? "Kora could not complete the refund", koraResponse: toJson(raw) },
    });
    await orderEvent(tx, order.id, { kind: "kora", title: "refund.failed", detail: message ?? "Kora could not complete the refund", amountKobo: refund.amountKobo, koraReference: reference, signature });
    return { changed: true };
  });
}

export async function reconcileRefund(reference: string, cause: Cause, webhookStatus?: "success" | "failed"): Promise<{ changed: boolean }> {
  try {
    const q = await kora().queryRefund(reference);
    const s = q.data.status;
    const status = s === "success" || s === "failed" ? s : (webhookStatus ?? "processing");
    return applyRefundOutcome(reference, status, null, q.raw, cause);
  } catch (err) {
    if (isKoraError(err) && webhookStatus) {
      return applyRefundOutcome(reference, webhookStatus, null, { source: "signed webhook", queryError: err.toJSON() }, cause);
    }
    throw err;
  }
}
