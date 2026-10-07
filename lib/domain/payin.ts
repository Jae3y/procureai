import { db, transaction, type Tx } from "@/lib/db";
import { env } from "@/lib/env";
import type { Order, PayIn, PayInStatus } from "@/lib/generated/prisma/client";
import { kora } from "@/lib/kora/client";
import { KORA_MAX_CHARGE_KOBO } from "@/lib/kora/limits";
import { isKoraError, KoraDuplicateReferenceError } from "@/lib/kora/errors";
import { log } from "@/lib/log";
import { formatNaira, type Kobo } from "@/lib/money";
import { DomainError, NotFoundError, UnknownReferenceError } from "./errors";
import { issueHandoverCode } from "./handover";
import { recordApiEvent, toJson } from "./kora-events";
import { dispatchStage } from "./payouts";
import { type Cause, lockOrder, transition } from "./state";
import { orderEvent } from "./timeline";

/**
 * PAY-IN — one-time Kora bank-transfer accounts, and the truthful-amounts rule:
 *
 *   For bank transfers the webhook carries the amount we REQUESTED, not what was paid
 *   (docs: handling-underpayments-and-overpayments.md). So every charge event — webhook, poller,
 *   or a buyer pressing "I've sent it" — re-queries GET /charges/:reference and credits the order
 *   from Kora's `amount_accepted` (falling back to `amount_paid` only if Kora omits it).
 *
 * Applying a query result is idempotent and monotonic: a PayIn leaves PROCESSING exactly once, so
 * the webhook, the poller and a manual re-check can race and still produce one credit and one
 * state change.
 */

export type ChargeSnapshot = {
  status: string;
  amountKobo: Kobo;
  paidKobo: Kobo | null;
  acceptedKobo: Kobo | null;
  feeKobo: Kobo | null;
  paymentEvent: string | null;
  message: string | null;
};

export type FollowUp =
  | { kind: "DISPATCH_STAGE_1" }
  | { kind: "TOP_UP"; shortfallKobo: Kobo }
  | { kind: "NEXT_INSTALMENT"; remainingKobo: Kobo }
  | { kind: "NEW_ACCOUNT" }
  | null;

/**
 * initial      — the order's first account
 * instalment   — the next account of a planned split (Kora caps one account at ₦1,000,000)
 * top-up       — the rest after a genuine underpayment
 * replacement  — a fresh account after an earlier one expired or its creation outcome was unknown
 */
export type PayInKind = "initial" | "instalment" | "top-up" | "replacement";
export type ApplyResult = { changed: boolean; followUp: FollowUp; orderId: string };

function payInReference(orderId: string, sequence: number, kind: PayInKind): string {
  if (sequence === 1) return `PA-${orderId}`;
  return `PA-${orderId}-${kind === "top-up" ? "T" : kind === "instalment" ? "P" : "R"}${sequence}`;
}

async function nextSequence(orderId: string): Promise<number> {
  const last = await db().payIn.findFirst({ where: { orderId }, orderBy: { sequence: "desc" }, select: { sequence: true } });
  return (last?.sequence ?? 0) + 1;
}

/**
 * Creates a Kora one-time account for `amountKobo` and records it. Kora is called first (outside
 * any lock), then the PayIn and the order transition are written together. If Kora reports the
 * reference already exists (an earlier attempt landed but we never heard back), a fresh reference
 * is used: the orphaned account was never shown to anyone and expires unpaid.
 */
export async function openPayIn(
  orderId: string,
  amountKobo: Kobo,
  kind: PayInKind,
  cause: Cause,
): Promise<PayIn> {
  const order = await db().order.findUnique({
    where: { id: orderId },
    include: { request: { include: { buyer: true } }, vendor: true },
  });
  if (!order) throw new NotFoundError("Order");
  const e = env();
  const k = kora();
  // Kora caps one bank-transfer account at ₦1,000,000 (real sandbox: 422 "amount must be less than
  // or equal to 1000000"). Larger orders are paid across several accounts, each credited from Kora's
  // own answer — never by pretending one account took more than Kora allows.
  const requestKobo = !e.ENABLE_CHECKOUT_REDIRECT && amountKobo > KORA_MAX_CHARGE_KOBO ? KORA_MAX_CHARGE_KOBO : amountKobo;

  let sequence = await nextSequence(orderId);
  for (let attempt = 0; attempt < 2; attempt++, sequence++) {
    const reference = payInReference(orderId, sequence, kind);
    try {
      const metadata = { orderId, orderNumber: String(order.number), kind };
      const accountName = `ProcureAI / PA-${String(order.number).padStart(4, "0")}`;
      const customer = { name: order.request.buyer.name, email: order.request.buyer.email };
      const narration = `ProcureAI PA-${String(order.number).padStart(4, "0")} · ${order.request.item}`;

      // Each channel normalises its own answer, so everything below is channel-agnostic.
      const opened = e.ENABLE_CHECKOUT_REDIRECT
        ? await k
            .initializeCheckout({ reference, amountKobo: requestKobo, customer, narration, notificationUrl: e.KORA_WEBHOOK_URL, redirectUrl: `${e.APP_BASE_URL}/orders/${orderId}/pay`, metadata })
            .then((r) => ({
              raw: r.raw,
              channel: "checkout",
              expectedKobo: requestKobo,
              feeKobo: null,
              accountNumber: null,
              accountName: null,
              bankName: null,
              expiresAt: null,
              checkoutUrl: r.data.checkout_url,
            }))
        : await k
            .createBankTransferCharge({ reference, amountKobo: requestKobo, customer, accountName, narration, notificationUrl: e.KORA_WEBHOOK_URL, metadata, autoComplete: false })
            .then((r) => ({
              raw: r.raw,
              channel: "bank_transfer",
              expectedKobo: r.data.amount_expected ?? r.data.amount,
              feeKobo: r.data.fee ?? null,
              accountNumber: r.data.bank_account.account_number,
              accountName: r.data.bank_account.account_name,
              bankName: r.data.bank_account.bank_name,
              expiresAt: r.data.bank_account.expiry_date_in_utc ? new Date(r.data.bank_account.expiry_date_in_utc) : null,
              checkoutUrl: null,
            }));

      return await transaction(async (tx) => {
        let locked = await lockOrder(tx, orderId);
        const isTransfer = opened.channel === "bank_transfer";
        const payIn = await tx.payIn.create({
          data: {
            orderId,
            sequence,
            reference,
            channel: opened.channel,
            amountRequestedKobo: requestKobo,
            amountExpectedKobo: opened.expectedKobo,
            feeKobo: opened.feeKobo,
            accountNumber: opened.accountNumber,
            accountName: opened.accountName,
            bankName: opened.bankName,
            expiresAt: opened.expiresAt,
            checkoutUrl: opened.checkoutUrl,
            koraResponse: toJson(opened.raw),
          },
        });
        await tx.order.update({
          where: { id: orderId },
          data: {
            chargeReference: reference,
            virtualAccount: toJson({
              accountNumber: payIn.accountNumber,
              accountName: payIn.accountName,
              bankName: payIn.bankName,
              expiresAt: payIn.expiresAt?.toISOString() ?? null,
              checkoutUrl: payIn.checkoutUrl,
              reference,
            }),
          },
        });
        // An UNDERPAID order stays UNDERPAID while the account for the rest is open (the shortfall
        // is what the buyer must see); only a fresh order moves to AWAITING_PAYMENT.
        if (locked.status === "CREATED") {
          locked = await transition(tx, locked, "AWAITING_PAYMENT", { ...cause, note: `account ${reference}` });
        }
        await orderEvent(tx, orderId, {
          kind: "info",
          title: kind === "top-up" ? "Account for the rest is ready" : kind === "instalment" ? "Account for the next transfer is ready" : "One-time account ready",
          detail: isTransfer
            ? `${bankLabel(payIn.bankName)} · ${spaced(payIn.accountNumber ?? "")} · ${formatNaira(payIn.amountExpectedKobo)}`
            : `Kora checkout · ${formatNaira(amountKobo)}`,
          amountKobo: payIn.amountExpectedKobo,
          koraReference: reference,
          signature: "API",
        });
        return payIn;
      });
    } catch (err) {
      if (err instanceof KoraDuplicateReferenceError && attempt === 0) {
        log.warn({ orderId, reference }, "charge reference already exists at Kora; opening a replacement account");
        continue;
      }
      throw err;
    }
  }
  throw new DomainError("payin_unavailable", "Kora could not open a payment account for this order. Try again.", 502);
}

function payInStatusFor(koraStatus: string): PayInStatus | null {
  if (koraStatus === "success") return "SUCCESS";
  if (koraStatus === "failed") return "FAILED";
  if (koraStatus === "expired") return "EXPIRED";
  return null;
}

/**
 * Applies one Kora answer about a charge. Runs under the order lock; safe to call any number of
 * times with any mix of stale and fresh answers.
 */
export async function applyChargeSnapshot(reference: string, snap: ChargeSnapshot, raw: unknown, cause: Cause): Promise<ApplyResult> {
  return transaction(async (tx) => {
    const found = await tx.payIn.findUnique({ where: { reference }, select: { orderId: true } });
    if (!found) throw new UnknownReferenceError(reference);
    let order = await lockOrder(tx, found.orderId);
    const payIn = await tx.payIn.findUniqueOrThrow({ where: { reference } });

    await recordApiEvent(tx, {
      type: "charge.query",
      reference,
      orderId: order.id,
      raw,
      fingerprint: { reference, status: snap.status, paid: snap.paidKobo?.toString(), accepted: snap.acceptedKobo?.toString(), event: snap.paymentEvent },
    });
    await tx.payIn.update({ where: { id: payIn.id }, data: { lastQueriedAt: new Date(), lastQueryResponse: toJson(raw) } });

    if (payIn.status !== "PROCESSING") return { changed: false, followUp: null, orderId: order.id };

    const signature = cause.type === "WEBHOOK" ? "VERIFIED" : "API";
    const final = payInStatusFor(snap.status);

    if (final === "SUCCESS") {
      const paid = snap.paidKobo ?? snap.acceptedKobo ?? snap.amountKobo;
      const accepted = snap.acceptedKobo ?? paid;
      await tx.payIn.update({
        where: { id: payIn.id },
        data: { status: "SUCCESS", amountPaidKobo: paid, amountAcceptedKobo: accepted, feeKobo: snap.feeKobo, creditedAt: new Date() },
      });
      if (accepted > 0n) {
        await tx.ledgerEntry.createMany({
          data: [
            { orderId: order.id, account: "BUYER_PAYIN", direction: "DEBIT", amountKobo: accepted, koraReference: reference, sourceType: "PAYIN", sourceId: payIn.id },
            { orderId: order.id, account: "HELD", direction: "CREDIT", amountKobo: accepted, koraReference: reference, sourceType: "PAYIN", sourceId: payIn.id },
          ],
        });
      }
      order = await tx.order.update({
        where: { id: order.id },
        data: { amountPaidKobo: order.amountPaidKobo + paid, amountAcceptedKobo: order.amountAcceptedKobo + accepted },
      });
      await orderEvent(tx, order.id, {
        kind: "kora",
        title: "charge.success",
        detail: payIn.accountNumber ? `Paid into ${spaced(payIn.accountNumber)}` : "Paid by checkout",
        amountKobo: accepted,
        koraReference: reference,
        signature,
      });
      if (snap.paymentEvent === "overpayment" || accepted > payIn.amountExpectedKobo) {
        await orderEvent(tx, order.id, {
          kind: "info",
          title: "Overpaid",
          detail: snap.message ?? `Kora accepted ${formatNaira(accepted)} against ${formatNaira(payIn.amountExpectedKobo)} expected.`,
          koraReference: reference,
        });
      }
      return afterCredit(tx, order, cause, accepted >= payIn.amountExpectedKobo);
    }

    if (final === "FAILED" || final === "EXPIRED") {
      await tx.payIn.update({ where: { id: payIn.id }, data: { status: final } });
      await orderEvent(tx, order.id, {
        kind: "kora",
        title: final === "FAILED" ? "charge.failed" : "charge.expired",
        detail: final === "EXPIRED" ? "The one-time account closed before payment arrived" : snap.message ?? "Kora marked this payment failed",
        koraReference: reference,
        signature,
      });
      return { changed: true, followUp: { kind: "NEW_ACCOUNT" }, orderId: order.id };
    }

    // Still processing. With Kora's default "Return all" preference an underpayment is reversed to
    // the payer and the charge stays processing — nothing is held, so say so once.
    // Polled every few seconds, so each reversed amount is reported once, not once per poll.
    const reported = (title: string, amountKobo: Kobo) =>
      tx.orderEvent.count({ where: { orderId: order.id, koraReference: reference, title, amountKobo } }).then((n) => n > 0);
    if (snap.paidKobo !== null && snap.paidKobo > 0n && snap.paidKobo < payIn.amountExpectedKobo && !(await reported("charge.underpaid", snap.paidKobo))) {
      await orderEvent(tx, order.id, {
        kind: "kora",
        title: "charge.underpaid",
        detail: snap.message ?? `${formatNaira(snap.paidKobo)} arrived but ${formatNaira(payIn.amountExpectedKobo)} was expected; Kora returned it to the payer.`,
        amountKobo: snap.paidKobo,
        koraReference: reference,
        signature,
      });
    }
    // The same preference reverses an overpayment in full, too.
    if (snap.paymentEvent === "overpayment" && snap.paidKobo !== null && snap.paidKobo > payIn.amountExpectedKobo && !(await reported("charge.overpaid", snap.paidKobo))) {
      await orderEvent(tx, order.id, {
        kind: "kora",
        title: "charge.overpaid",
        detail: snap.message ?? `${formatNaira(snap.paidKobo)} arrived but ${formatNaira(payIn.amountExpectedKobo)} was expected; Kora returned it to the payer.`,
        amountKobo: snap.paidKobo,
        koraReference: reference,
        signature,
      });
    }
    return { changed: false, followUp: null, orderId: order.id };
  });
}

async function afterCredit(tx: Tx, order: Order, cause: Cause, accountFullyPaid: boolean): Promise<ApplyResult> {
  if (order.amountAcceptedKobo >= order.amountKobo) {
    if (order.status === "AWAITING_PAYMENT" || order.status === "UNDERPAID") {
      const held = await transition(tx, order, "HELD", cause);
      await issueHandoverCode(tx, held);
      return { changed: true, followUp: { kind: "DISPATCH_STAGE_1" }, orderId: order.id };
    }
    return { changed: true, followUp: null, orderId: order.id };
  }
  const shortfallKobo = order.amountKobo - order.amountAcceptedKobo;
  if (accountFullyPaid && order.status === "AWAITING_PAYMENT") {
    // A planned instalment, not an underpayment: this account received everything it asked for.
    await orderEvent(tx, order.id, {
      kind: "info",
      title: "Transfer received",
      detail: `${formatNaira(order.amountAcceptedKobo)} of ${formatNaira(order.amountKobo)} received. Kora takes up to ₦1,000,000 per account, so the next account is for ${formatNaira(shortfallKobo)}.`,
      amountKobo: shortfallKobo,
    });
    return { changed: true, followUp: { kind: "NEXT_INSTALMENT", remainingKobo: shortfallKobo }, orderId: order.id };
  }
  if (accountFullyPaid && order.status === "UNDERPAID") {
    // The top-up account was paid in full but Kora's cap kept it below the whole shortfall.
    await orderEvent(tx, order.id, {
      kind: "info",
      title: "Transfer received",
      detail: `${formatNaira(order.amountAcceptedKobo)} of ${formatNaira(order.amountKobo)} received. Kora takes up to ₦1,000,000 per account, so the next account is for ${formatNaira(shortfallKobo)}.`,
      amountKobo: shortfallKobo,
    });
    return { changed: true, followUp: { kind: "TOP_UP", shortfallKobo }, orderId: order.id };
  }
  if (order.status === "AWAITING_PAYMENT") await transition(tx, order, "UNDERPAID", { ...cause, note: `short ${formatNaira(shortfallKobo)}` });
  await orderEvent(tx, order.id, {
    kind: "error",
    title: `${formatNaira(shortfallKobo)} short.`,
    detail: `We received ${formatNaira(order.amountAcceptedKobo)}. Nothing goes to the vendor until the full amount is here.`,
    amountKobo: shortfallKobo,
  });
  return { changed: true, followUp: { kind: "TOP_UP", shortfallKobo }, orderId: order.id };
}

/** Kora returns bank names like "wema"; show them as people say them. */
export function bankLabel(name: string | null | undefined): string {
  if (!name) return "Bank";
  const n = name.trim();
  const titled = n.charAt(0).toUpperCase() + n.slice(1);
  return /bank/i.test(titled) ? titled : `${titled} Bank`;
}

function spaced(account: string): string {
  return account.replace(/^(\d{3})(\d{3})(\d+)$/, "$1 $2 $3");
}

export function snapshotFromQuery(data: {
  status: string;
  amount: Kobo;
  amount_paid?: Kobo | null;
  amount_accepted?: Kobo | null;
  fee?: Kobo | null;
  bank_transfer?: { payment_event?: string | null; message?: string | null } | null;
}): ChargeSnapshot {
  return {
    status: data.status,
    amountKobo: data.amount,
    paidKobo: data.amount_paid ?? null,
    acceptedKobo: data.amount_accepted ?? null,
    feeKobo: data.fee ?? null,
    paymentEvent: data.bank_transfer?.payment_event ?? null,
    message: data.bank_transfer?.message ?? null,
  };
}

/**
 * The one entry point for "what does Kora say about this charge?" — used by the webhook worker,
 * the reconciliation poller and the Re-check button alike.
 */
export async function reconcileCharge(reference: string, cause: Cause): Promise<ApplyResult> {
  const q = await kora().queryCharge(reference);
  const result = await applyChargeSnapshot(reference, snapshotFromQuery(q.data), q.raw, cause);
  await runFollowUp(result, cause);
  return result;
}

export async function runFollowUp(result: ApplyResult, cause: Cause): Promise<void> {
  const f = result.followUp;
  if (!f) return;
  try {
    if (f.kind === "DISPATCH_STAGE_1") await dispatchStage(result.orderId, "STAGE_1", cause);
    if (f.kind === "TOP_UP" && f.shortfallKobo > 0n) await ensureOpenPayIn(result.orderId, f.shortfallKobo, "top-up", cause);
    if (f.kind === "NEXT_INSTALMENT" && f.remainingKobo > 0n) await ensureOpenPayIn(result.orderId, f.remainingKobo, "instalment", cause);
  } catch (err) {
    // The money state is already committed; the poller's self-heal pass retries this follow-up.
    log.error({ err, orderId: result.orderId, followUp: f.kind }, "follow-up after charge failed");
    await transaction((tx) =>
      orderEvent(tx, result.orderId, {
        kind: "error",
        title: f.kind === "DISPATCH_STAGE_1" ? "Stage 1 not sent yet" : "Couldn't open an account for the rest",
        detail: isKoraError(err) ? err.userMessage : "Something went wrong; ProcureAI will retry automatically.",
      }),
    );
  }
}

/** Opens a new account only if the order has no PROCESSING pay-in already. */
export async function ensureOpenPayIn(orderId: string, amountKobo: Kobo, kind: PayInKind, cause: Cause): Promise<PayIn | null> {
  const open = await db().payIn.findFirst({ where: { orderId, status: "PROCESSING" } });
  if (open) return null;
  return openPayIn(orderId, amountKobo, kind, cause);
}
