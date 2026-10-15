import { db, transaction } from "@/lib/db";
import { env } from "@/lib/env";
import type { EvidenceKind, MessageSender } from "@/lib/generated/prisma/client";
import { formatNaira, splitStages } from "@/lib/money";
import { DomainError, NotFoundError } from "./errors";
import { cleanNote, decodePhoto, type EvidenceInput } from "./evidence";
import { dispatchStage, type DispatchResult } from "./payouts";
import { refundOrder } from "./refunds";
import { type Cause, lockOrder, transition } from "./state";
import { orderEvent } from "./timeline";

/**
 * Delivery without the code, the escrow way:
 *  1. The vendor marks the order delivered, with a note and (ideally) a photo.
 *  2. The buyer then has DELIVERY_GRACE_HOURS to report a problem.
 *  3. If they don't, Stage 2 releases by itself — the code is the fast path, not the only key.
 *  4. A dispute freezes payouts; each side adds its evidence; an admin rules for the buyer (refund
 *     what is still held) or for the vendor (Stage 2, exactly as if the code had been entered).
 *
 * Stage 2 always goes out through the one existing path — CODE_VERIFIED, then dispatchStage — so the
 * payout rules (I1–I4, the ledger, retries) are unchanged.
 */

export function graceMs(): number {
  return env().DELIVERY_GRACE_HOURS * 60 * 60 * 1000;
}

/** Vendor: "I delivered" with proof. Starts the buyer's window to report a problem. Once per order. */
export async function markDelivered(orderId: string, vendorId: string, input: EvidenceInput): Promise<{ autoReleaseAt: Date }> {
  const note = cleanNote(input.note);
  const photo = decodePhoto(input.photo);
  return transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (order.vendorId !== vendorId) throw new DomainError("forbidden", "This isn't your order.", 403);
    if (order.deliveredAt && order.autoReleaseAt) return { autoReleaseAt: order.autoReleaseAt };
    if (order.status !== "STAGE_1_PAID") throw new DomainError("not_deliverable", "You can mark delivery once Stage 1 has reached you.", 409);
    const stage1 = await tx.payout.findFirst({ where: { orderId, stage: "STAGE_1", status: "SUCCESS" } });
    if (!stage1) throw new DomainError("stage1_pending", "Stage 1 hasn't landed with you yet. Try again in a moment.", 409);

    const now = new Date();
    const autoReleaseAt = new Date(now.getTime() + graceMs());
    await tx.order.update({ where: { id: orderId }, data: { deliveredAt: now, autoReleaseAt } });
    await tx.orderEvidence.create({ data: { orderId, party: "VENDOR", kind: "DELIVERY", note, photo: photo?.bytes ?? null, photoType: photo?.type ?? null } });
    await orderEvent(tx, orderId, {
      kind: "info",
      title: "Vendor marked it delivered",
      detail: `${photo ? "With a photo. " : ""}Stage 2 releases automatically after ${env().DELIVERY_GRACE_HOURS} hours unless the buyer reports a problem.`,
    });
    return { autoReleaseAt };
  });
}

/**
 * Releases Stage 2 for every delivered order whose window has passed without a dispute.
 * Idempotent and race-safe: the order row lock serialises it with code entry and disputes.
 */
export async function releaseDueDeliveries(now = new Date(), onlyOrderId?: string): Promise<number> {
  const due = await db().order.findMany({
    where: { status: "STAGE_1_PAID", autoReleaseAt: { lte: now }, ...(onlyOrderId ? { id: onlyOrderId } : {}) },
    select: { id: true },
    take: 20,
  });
  let released = 0;
  for (const { id } of due) {
    const moved = await transaction(async (tx) => {
      const order = await lockOrder(tx, id);
      if (order.status !== "STAGE_1_PAID" || !order.autoReleaseAt || order.autoReleaseAt > now) return false;
      const stage1 = await tx.payout.findFirst({ where: { orderId: id, stage: "STAGE_1", status: "SUCCESS" } });
      if (!stage1) return false;
      await tx.order.update({ where: { id }, data: { codeUsedAt: now } });
      await transition(tx, order, "CODE_VERIFIED", {
        type: "SYSTEM",
        id: "auto-release",
        note: `no problem reported within ${env().DELIVERY_GRACE_HOURS} h of delivery`,
      });
      await orderEvent(tx, id, {
        kind: "info",
        title: "Released after delivery",
        detail: `No problem was reported within ${env().DELIVERY_GRACE_HOURS} hours of the vendor's delivery, so Stage 2 is released.`,
      });
      return true;
    });
    if (!moved) continue;
    released++;
    // The poller re-dispatches a CODE_VERIFIED order without Stage 2 if this call is interrupted.
    await dispatchStage(id, "STAGE_2", { type: "SYSTEM", id: "auto-release" });
  }
  return released;
}

/** Buyer or vendor adds their side of a dispute (note + optional photo). */
export async function addDisputeEvidence(orderId: string, party: MessageSender, input: EvidenceInput): Promise<void> {
  const note = cleanNote(input.note);
  const photo = decodePhoto(input.photo);
  await transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (order.status !== "DISPUTED") throw new DomainError("not_disputed", "This order isn't in a dispute.", 409);
    const count = await tx.orderEvidence.count({ where: { orderId, kind: "DISPUTE", party } });
    if (count >= 5) throw new DomainError("evidence_limit", "You've already added 5 pieces of evidence. ProcureAI will be in touch.", 409);
    await tx.orderEvidence.create({ data: { orderId, party, kind: "DISPUTE", note, photo: photo?.bytes ?? null, photoType: photo?.type ?? null } });
    await orderEvent(tx, orderId, { kind: "info", title: party === "BUYER" ? "Buyer added evidence" : "Vendor added evidence", detail: photo ? "A note and a photo." : "A note." });
  });
}

export type Ruling = "buyer" | "vendor";

/**
 * Admin settles a dispute. For the buyer: what is still held goes back through Kora (refundOrder).
 * For the vendor: Stage 2 goes out exactly as if the code had been entered — only once Stage 1 has
 * landed, so a dispute raised before Stage 1 can only end in a refund.
 */
export async function resolveDispute(
  orderId: string,
  ruling: Ruling,
  cause: Cause,
): Promise<{ ruling: Ruling; message: string; refund?: { reference: string; status: string }; stage2?: DispatchResult["kind"] }> {
  if (ruling === "buyer") {
    const refund = await refundOrder(orderId, cause);
    return { ruling, refund, message: `Refund ${refund.reference} sent to Kora: ${refund.status}.` };
  }
  const order = await transaction(async (tx) => {
    const o = await lockOrder(tx, orderId);
    if (o.status !== "DISPUTED") throw new DomainError("not_disputed", "Only a disputed order can be resolved.", 409);
    const stage1 = await tx.payout.findFirst({ where: { orderId, stage: "STAGE_1", status: "SUCCESS" } });
    if (!stage1) throw new DomainError("stage1_not_paid", "Stage 1 never reached the vendor, so this dispute can only end in a refund.", 409);
    // A refund already sent (or done) owns the held money: the vendor can't be paid it as well.
    const refund = await tx.refund.findFirst({ where: { orderId, status: { not: "FAILED" } } });
    if (refund) throw new DomainError("refund_in_progress", `A refund (${refund.reference}) is already ${refund.status.toLowerCase()} for this order.`, 409);
    await tx.order.update({ where: { id: orderId }, data: { codeUsedAt: o.codeUsedAt ?? new Date() } });
    await transition(tx, o, "CODE_VERIFIED", { ...cause, note: "dispute resolved for the vendor" });
    await orderEvent(tx, orderId, { kind: "info", title: "Dispute resolved for the vendor", detail: "ProcureAI reviewed both sides; Stage 2 is released." });
    return o;
  });
  const stage2 = await dispatchStage(orderId, "STAGE_2", cause);
  const what =
    stage2.kind === "sent" || stage2.kind === "pending-unknown"
      ? "sent to Kora"
      : stage2.kind === "failed"
        ? `refused by Kora (${stage2.error.userMessage}); retry it from the tracker`
        : stage2.kind === "blocked"
          ? `waiting: ${stage2.message}`
          : "already on its way";
  return { ruling, stage2: stage2.kind, message: `Ruled for the vendor: Stage 2 (${formatNaira(splitStages(order.amountKobo).stage2)}) ${what}.` };
}

/** Demo only: end the buyer's window now and run the release, so a pitch doesn't wait 72 hours. */
export async function skipDeliveryWait(orderId: string): Promise<number> {
  const order = await db().order.findUnique({ where: { id: orderId } });
  if (!order) throw new NotFoundError("Order");
  if (!order.deliveredAt) throw new DomainError("not_delivered", "The vendor hasn't marked this order delivered yet.", 409);
  const now = new Date();
  await transaction(async (tx) => {
    const o = await lockOrder(tx, orderId);
    if (o.status !== "STAGE_1_PAID") return;
    await tx.order.update({ where: { id: orderId }, data: { autoReleaseAt: now } });
    await orderEvent(tx, orderId, { kind: "info", title: "Demo: waiting period skipped", detail: "The presenter ended the buyer's window early." });
  });
  return releaseDueDeliveries(now, orderId);
}

export async function evidenceKinds(orderId: string): Promise<Array<{ party: MessageSender; kind: EvidenceKind }>> {
  return db().orderEvidence.findMany({ where: { orderId }, select: { party: true, kind: true } });
}
