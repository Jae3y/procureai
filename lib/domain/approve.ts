import { db, transaction } from "@/lib/db";
import { isPlus } from "./ai-allowance";
import { buyerPaysKobo, feesForOrder } from "./fees";
import { env } from "@/lib/env";
import type { Order } from "@/lib/generated/prisma/client";
import { formatNaira, type Kobo, splitStages } from "@/lib/money";
import { payments } from "@/lib/payments";
import { DomainError, NotFoundError } from "./errors";
import { BANK_VERIFIED_MAX_KOBO } from "./matching";
import { MAX_ORDER_KOBO } from "./payout-parts";
import { openPayIn } from "./payin";
import { latestVerifications } from "./recommend";
import type { Cause } from "./state";
import { requestEvent } from "./timeline";

/**
 * The buyer approves one vendor: an Order is created against that vendor's latest VERIFIED
 * verification (the DB refuses anything else — I1), then Kora opens the one-time account.
 *
 * Idempotent and resumable: one order per request (unique), so a repeat returns the same order,
 * and if Kora couldn't open the account the first time, the repeat opens it.
 */
/**
 * Each stage is paid out in one or more transfers, and the payment provider only pays out between its minimum
 * and maximum per transfer (Kora: ₦1,000 to ₦10,000,000). An order whose 30% is below the minimum would get
 * stuck after the buyer paid, so it is refused before any money moves. Above the maximum a stage is split into parts.
 */
/** Sellers with fewer completed orders than this get the smaller first payout. */
export const TRACK_RECORD_ORDERS = 3;
export const NEW_SELLER_STAGE1_BP = 1000; // 10%
export const STANDARD_STAGE1_BP = 3000; // 30%

/** 10% first for a seller still building a track record (fewer than 3 completed orders on ProcureAI), else 30%. */
export async function stage1ShareFor(vendor: { contactId: string | null }): Promise<number> {
  if (!vendor.contactId) return NEW_SELLER_STAGE1_BP;
  const completed = await db().order.count({ where: { status: "COMPLETE", vendor: { contactId: vendor.contactId } } });
  return completed >= TRACK_RECORD_ORDERS ? STANDARD_STAGE1_BP : NEW_SELLER_STAGE1_BP;
}

export function assertPayableInStages(totalKobo: Kobo, stage1Bp = STANDARD_STAGE1_BP): void {
  const { minPayoutKobo } = payments().limits;
  const { stage1 } = splitStages(totalKobo, stage1Bp);
  if (stage1 < minPayoutKobo) {
    const bp = BigInt(stage1Bp);
    const min = (minPayoutKobo * 10_000n + bp - 1n) / bp; // smallest total whose first payout reaches the minimum
    throw new DomainError("order_too_small", `ProcureAI can protect orders from ${formatNaira(min)}. This one is ${formatNaira(totalKobo)}.`, 409);
  }
  // A stage bigger than the provider's per-transfer maximum is paid in several transfers (see payout-parts.ts),
  // so the ceiling is ProcureAI's own, not the provider's.
  if (totalKobo > MAX_ORDER_KOBO) {
    throw new DomainError("order_too_large", `For now ProcureAI can protect orders up to ${formatNaira(MAX_ORDER_KOBO)}. This one is ${formatNaira(totalKobo)}; split it into smaller orders.`, 409);
  }
}

export async function approve(requestId: string, quoteId: string | null, cause: Cause): Promise<Order> {
  const request = await db().request.findUnique({
    where: { id: requestId },
    include: { order: true, recommendations: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!request) throw new NotFoundError("Request");

  let order = request.order;
  if (!order) {
    const chosenId = quoteId ?? request.recommendations[0]?.chosenQuoteId ?? null;
    if (!chosenId) throw new DomainError("no_choice", "There is no recommended vendor to approve.", 409);
    const quote = await db().quote.findUnique({ where: { id: chosenId }, include: { vendor: true } });
    if (!quote || quote.requestId !== requestId) throw new DomainError("bad_quote", "That quote is not part of this request.", 400);
    if (quote.totalKobo === null) throw new DomainError("no_price", "That quote has no price to pay.", 409);
    const verification = (await latestVerifications([quote.vendorId])).get(quote.vendorId);
    if (!verification || verification.verdict !== "VERIFIED") {
      throw new DomainError("unverified", `${quote.vendor.label} is not verified, so ProcureAI won't send it money.`, 409);
    }
    const totalKobo = quote.totalKobo;
    const stage1Bp = await stage1ShareFor(quote.vendor);
    if (verification.matchMethod === "ACCOUNT_OWNER" && totalKobo > BANK_VERIFIED_MAX_KOBO) {
      throw new DomainError(
        "over_seller_limit",
        `For now, purchases from sellers without a CAC registration are protected up to ${formatNaira(BANK_VERIFIED_MAX_KOBO)}. This quote is ${formatNaira(totalKobo)}. You can ask ${quote.vendor.label} for a smaller first order, or choose a registered business.`,
        409,
      );
    }
    const buyerAccount = await db().account.findUnique({ where: { buyerId: request.buyerId }, select: { plusUntil: true } });
    const seller = quote.vendor.contactId ? await db().vendorContact.findUnique({ where: { id: quote.vendor.contactId }, select: { foundingNumber: true, registeredAt: true } }) : null;
    const fees = feesForOrder({ enabled: env().FEES_ENABLED, isDemo: request.isDemo, amountKobo: totalKobo, buyerIsPlus: buyerAccount ? isPlus(buyerAccount) : false, seller });
    // The stages pay out what the vendor receives, so that is what must clear the provider's minimum.
    assertPayableInStages(totalKobo - fees.sellerFeeKobo, stage1Bp);
    order = await transaction(async (tx) => {
      const existing = await tx.order.findUnique({ where: { requestId } });
      if (existing) return existing;
      const created = await tx.order.create({
        data: { requestId, quoteId: quote.id, vendorId: quote.vendorId, verificationId: verification.id, amountKobo: totalKobo, stage1Bp, ...fees },
      });
      await tx.request.update({ where: { id: requestId }, data: { status: "APPROVED" } });
      await tx.orderEvent.create({
        data: { orderId: created.id, kind: "info", title: `Approved ${quote.vendor.label}`, detail: quote.vendor.name ?? null, amountKobo: totalKobo },
      });
      return created;
    });
    await requestEvent(requestId, { kind: "info", title: `Approved ${quote.vendor.label}` });
  }

  if (order.status === "CREATED") {
    const open = await db().payIn.findFirst({ where: { orderId: order.id, status: "PROCESSING" } });
    if (!open) await openPayIn(order.id, buyerPaysKobo(order), "initial", cause);
    order = await db().order.findUniqueOrThrow({ where: { id: order.id } });
  }
  return order;
}
