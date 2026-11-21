import { db, transaction, type Tx } from "@/lib/db";
import { removePhoto, storePhoto } from "@/lib/storage/photos";
import { isProviderError, providerFor } from "@/lib/payments";
import { formatNaira, type Kobo } from "@/lib/money";
import { DomainError, NotFoundError, UnknownReferenceError } from "./errors";
import { cleanNote, decodePhoto, type EvidenceInput } from "./evidence";
import { recordApiEvent, toJson } from "./kora-events";
import { type Cause, lockOrder, transition } from "./state";
import { orderEvent } from "./timeline";

/**
 * DISPUTED → REFUNDED. A dispute freezes the order (no further payouts can dispatch: the state
 * machine has no edge out of DISPUTED except REFUNDED). The refund returns what is still HELD —
 * money already paid to the vendor in Stage 1 is not clawed back by ProcureAI.
 * Same discipline as payouts: row first (PENDING, unique reference), then Kora, never blind-retried.
 */

export async function disputeOrder(orderId: string, reason: string, cause: Cause, photo?: EvidenceInput["photo"]): Promise<void> {
  const note = cleanNote(reason);
  const image = await storePhoto("evidence", decodePhoto(photo));
  let saved = false;
  await transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (order.status !== "HELD" && order.status !== "STAGE_1_PAID") {
      throw new DomainError("not_disputable", "This order can only be disputed while money is held, before delivery.", 409);
    }
    // After the vendor marks delivery, the buyer has a fixed window; once it ends, Stage 2 is the vendor's.
    if (order.autoReleaseAt && order.autoReleaseAt <= new Date()) {
      throw new DomainError("dispute_window_closed", "The time to report a problem with this delivery has ended.", 409);
    }
    await transition(tx, order, "DISPUTED", { ...cause, note: reason.slice(0, 200) });
    await orderEvent(tx, orderId, { kind: "error", title: "Disputed", detail: `${reason.slice(0, 200)} Payouts are frozen.` });
    await tx.orderEvidence.create({ data: { orderId, party: "BUYER", kind: "DISPUTE", note, ...image } });
    saved = true;
  }).finally(async () => {
    if (!saved) await removePhoto(image.photoUrl);
  });
}

/**
 * What can still be refunded: what is held, less payouts and refunds already on their way. Counting refunds in
 * flight matters: without it, pressing "refund" again before the provider confirms the first one would send the
 * same money back twice.
 */
async function refundableKobo(tx: Tx, orderId: string): Promise<{ refundable: Kobo; refundsInFlight: number }> {
  const [ledger, pendingPayouts, pendingRefunds] = await Promise.all([
    tx.ledgerEntry.findMany({ where: { orderId, account: "HELD" } }),
    tx.payout.findMany({ where: { orderId, status: "PENDING" } }),
    tx.refund.findMany({ where: { orderId, status: "PENDING" } }),
  ]);
  const held = ledger.reduce((a, r) => a + (r.direction === "CREDIT" ? r.amountKobo : -r.amountKobo), 0n);
  const committed = pendingPayouts.reduce((a, p) => a + p.amountKobo, 0n) + pendingRefunds.reduce((a, r) => a + r.amountKobo, 0n);
  return { refundable: held - committed, refundsInFlight: pendingRefunds.length };
}

/**
 * dispute     — the admin ruled for the buyer: everything still held goes back, and the order ends REFUNDED.
 * overpayment — a completed order still holds money the buyer paid on top: that goes back; the order stays COMPLETE.
 */
export type RefundPurpose = "dispute" | "overpayment";

const PURPOSE: Record<RefundPurpose, { status: "DISPUTED" | "COMPLETE"; refused: () => DomainError; reason: string }> = {
  dispute: { status: "DISPUTED", refused: () => new DomainError("not_disputed", "Only a disputed order can be refunded.", 409), reason: "Disputed order: held funds returned" },
  overpayment: {
    status: "COMPLETE",
    refused: () => new DomainError("not_complete", "Only a completed order's leftover money can be returned this way.", 409),
    reason: "Overpayment returned to the buyer",
  },
};

type Part = { paymentReference: string; provider: string; amountKobo: Kobo };

/**
 * Splits a refund across the order's successful payments, largest first, never taking more from a payment than it
 * brought in less what was already refunded from it. An order over the provider's per-account limit is paid in
 * several transfers, so its refund comes back the same way, one part per payment.
 */
function allocate(amountKobo: Kobo, payIns: Array<{ reference: string; provider: string; amountAcceptedKobo: Kobo }>, alreadyRefunded: Map<string, Kobo>): Part[] {
  const parts: Part[] = [];
  let left = amountKobo;
  for (const p of [...payIns].sort((a, b) => (a.amountAcceptedKobo > b.amountAcceptedKobo ? -1 : a.amountAcceptedKobo < b.amountAcceptedKobo ? 1 : 0))) {
    if (left <= 0n) break;
    const room = p.amountAcceptedKobo - (alreadyRefunded.get(p.reference) ?? 0n);
    if (room <= 0n) continue;
    const take = room < left ? room : left;
    parts.push({ paymentReference: p.reference, provider: p.provider, amountKobo: take });
    left -= take;
  }
  if (left > 0n) throw new DomainError("refund_exceeds_payments", "The held money is more than the payments can return. Check the order in the admin console.", 409);
  return parts;
}

export async function refundOrder(orderId: string, cause: Cause, purpose: RefundPurpose = "dispute"): Promise<{ reference: string; status: string }> {
  const rule = PURPOSE[purpose];
  const order = await db().order.findUnique({ where: { id: orderId } });
  if (!order) throw new NotFoundError("Order");
  if (order.status !== rule.status) throw rule.refused();

  const refunds = await transaction(async (tx) => {
    const locked = await lockOrder(tx, orderId);
    if (locked.status !== rule.status) throw rule.refused();
    const { refundable, refundsInFlight } = await refundableKobo(tx, orderId);
    const payIns = await tx.payIn.findMany({ where: { orderId, status: "SUCCESS" }, select: { reference: true, provider: true, amountAcceptedKobo: true } });
    if (payIns.length === 0) throw new DomainError("no_payment", "There is no successful payment to refund.", 409);
    const minKobo = providerFor(payIns[0]?.provider ?? "kora").limits.minRefundKobo;
    if (refundable < minKobo) {
      if (refundsInFlight > 0) throw new DomainError("refund_in_progress", "A refund for this order is already on its way. Wait for the payment provider to confirm it.", 409);
      throw new DomainError("refund_too_small", `Refunds start at ${formatNaira(minKobo)}; nothing refundable is held.`, 409);
    }
    const past = await tx.refund.findMany({ where: { orderId, status: { not: "FAILED" } }, select: { paymentReference: true, amountKobo: true } });
    const used = new Map<string, Kobo>();
    for (const r of past) used.set(r.paymentReference, (used.get(r.paymentReference) ?? 0n) + r.amountKobo);
    const parts = allocate(refundable, payIns, used);
    const tooSmall = parts.find((p) => p.amountKobo < providerFor(p.provider).limits.minRefundKobo);
    if (tooSmall) {
      throw new DomainError("refund_part_too_small", `Part of this refund (${formatNaira(tooSmall.amountKobo)} from ${tooSmall.paymentReference}) is below the provider's minimum; return it from the provider's dashboard.`, 409);
    }
    let n = await tx.refund.count({ where: { orderId } });
    const rows = [];
    for (const part of parts) {
      n += 1;
      rows.push(
        await tx.refund.create({
          data: { orderId, provider: part.provider, paymentReference: part.paymentReference, reference: `RF-${orderId}-${n}`, amountKobo: part.amountKobo, reason: rule.reason },
        }),
      );
    }
    return rows;
  });

  const statuses: string[] = [];
  for (const refund of refunds) statuses.push(await sendRefund(orderId, refund, cause));
  const status = statuses.every((s) => s === statuses[0]) ? (statuses[0] ?? "pending") : statuses.join(", ");
  return { reference: refunds.map((r) => r.reference).join(", "), status };
}

/** Sends one refund part to the provider that took the payment, and records what it said. */
async function sendRefund(orderId: string, refund: { reference: string; paymentReference: string; amountKobo: Kobo; reason: string; provider: string }, cause: Cause): Promise<string> {
  const provider = providerFor(refund.provider);
  try {
    const res = await provider.refund({ reference: refund.reference, paymentReference: refund.paymentReference, amountKobo: refund.amountKobo, reason: refund.reason });
    await transaction((tx) =>
      orderEvent(tx, orderId, {
        kind: "info",
        title: "Refund sent",
        detail: `${formatNaira(refund.amountKobo)} back to the buyer · ${res.data.status}`,
        amountKobo: refund.amountKobo,
        koraReference: refund.reference,
        signature: "API",
      }),
    );
    if (res.data.status !== "processing") await applyRefundOutcome(refund.reference, res.data.status, null, res.raw, cause);
    return res.data.status;
  } catch (err) {
    if (!isProviderError(err)) throw err;
    if (err.outcomeKnown) {
      await applyRefundOutcome(refund.reference, "failed", err.providerMessage ?? err.userMessage, err.body ?? { error: err.toJSON() }, cause);
      throw new DomainError("refund_failed", `${provider.name} refused the refund: ${err.providerMessage ?? err.userMessage}`, 502);
    }
    await transaction((tx) => orderEvent(tx, orderId, { kind: "info", title: "Confirming the refund", detail: err.userMessage, koraReference: refund.reference }));
    return "pending";
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
      // A refund in several parts ends the dispute only when no part is still on its way and nothing is left to return.
      if (order.status === "DISPUTED") {
        const { refundable, refundsInFlight } = await refundableKobo(tx, order.id);
        if (refundsInFlight === 0 && refundable <= 0n) order = await transition(tx, order, "REFUNDED", { ...cause, note: reference });
      }
      return { changed: true };
    }
    await tx.refund.update({
      where: { id: refund.id },
      data: { status: "FAILED", resolvedAt: new Date(), failureReason: message ?? "The refund could not be completed", koraResponse: toJson(raw) },
    });
    await orderEvent(tx, order.id, { kind: "kora", title: "refund.failed", detail: message ?? "The refund could not be completed", amountKobo: refund.amountKobo, koraReference: reference, signature });
    return { changed: true };
  });
}

export async function reconcileRefund(reference: string, cause: Cause, webhookStatus?: "success" | "failed"): Promise<{ changed: boolean }> {
  const refund = await db().refund.findUnique({ where: { reference }, select: { provider: true } });
  if (!refund) throw new UnknownReferenceError(reference);
  try {
    const q = await providerFor(refund.provider).queryRefund(reference);
    const status = q.data.status !== "processing" ? q.data.status : (webhookStatus ?? "processing");
    return applyRefundOutcome(reference, status, null, q.raw, cause);
  } catch (err) {
    if (isProviderError(err) && webhookStatus) {
      return applyRefundOutcome(reference, webhookStatus, null, { source: "signed webhook", queryError: err.toJSON() }, cause);
    }
    throw err;
  }
}
