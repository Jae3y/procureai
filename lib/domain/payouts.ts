import { db, transaction } from "@/lib/db";
import { env } from "@/lib/env";
import type { Payout, PayoutRoute, PayoutStage } from "@/lib/generated/prisma/client";
import { kora } from "@/lib/kora/client";
import { isKoraError, type KoraError } from "@/lib/kora/errors";
import { log } from "@/lib/log";
import { formatNaira, type Kobo, splitStages } from "@/lib/money";
import { DomainError, NotFoundError, UnknownReferenceError } from "./errors";
import { recordApiEvent, toJson } from "./kora-events";
import { getSetting } from "./settings";
import { type Cause, canTransition, lockOrder, retryTarget, transition } from "./state";
import { orderEvent } from "./timeline";

/**
 * PAYOUT — two stages, idempotent, never blind-retried.
 *
 *   1. Under the order lock, insert the Payout row (PENDING, unique reference) in the SAME
 *      transaction as the state change (HELD → STAGE_1_PAID, CODE_VERIFIED → RELEASED). Commit.
 *   2. Then call Kora. A 4xx means Kora refused: the payout FAILED, the order PAYOUT_FAILED.
 *      A timeout / 5xx / malformed reply means we don't know: the row stays PENDING and the
 *      reconciliation poller asks Kora (GET /transactions/:reference). Kora's own docs say not to
 *      treat these as failures. Sending again under a new reference could pay the vendor twice.
 *   3. Retry after a confirmed failure creates a NEW reference linked by retryOfId.
 *
 * Destination comes from the VendorVerification row only (never from a request body), and the DB
 * trigger I1 refuses anything else — except, with a test key, Kora's documented sandbox accounts.
 */

const STAGE_TAG: Record<PayoutStage, string> = { STAGE_1: "S1", STAGE_2: "S2" };
const STAGE_LABEL: Record<PayoutStage, string> = { STAGE_1: "Stage 1", STAGE_2: "Stage 2" };

const SANDBOX_ACCOUNTS = {
  SANDBOX_SUCCESS_033: { bank: "033", account: "0000000000" },
  SANDBOX_FAIL_035: { bank: "035", account: "0000000000" },
} as const;

export type DispatchResult =
  | { kind: "sent"; payout: Payout }
  | { kind: "pending-unknown"; payout: Payout; error: KoraError }
  | { kind: "failed"; payout: Payout; error: KoraError }
  | { kind: "blocked"; reason: "unfunded" | "balance-unavailable" | "vendor-email-missing"; message: string }
  | { kind: "skipped"; reason: string };

function stageAmount(totalKobo: Kobo, stage: PayoutStage): Kobo {
  const { stage1, stage2 } = splitStages(totalKobo);
  return stage === "STAGE_1" ? stage1 : stage2;
}

async function chooseRoute(verification: { bankCode: string; accountNumber: string }): Promise<{ route: PayoutRoute; bank: string; account: string }> {
  const setting = await getSetting("payoutRoute");
  if (setting !== "VERIFIED_ACCOUNT" && kora().isTestMode) {
    const s = SANDBOX_ACCOUNTS[setting];
    return { route: "SANDBOX_TEST_ACCOUNT", bank: s.bank, account: s.account };
  }
  // Against the real Kora sandbox (test key, real API), disbursements to non-sandbox test accounts
  // are rejected with "Invalid account." Automatically route to Kora's 033 success account.
  if (kora().isLiveSandbox) {
    return { route: "SANDBOX_TEST_ACCOUNT", bank: "033", account: "0000000000" };
  }
  return { route: "VERIFIED_ACCOUNT", bank: verification.bankCode, account: verification.accountNumber };
}

/**
 * "Check the Kora balance before Stage 1 and show a precise error if unfunded." Done before every
 * dispatch; a failed check blocks the payout (nothing is written) and says exactly why.
 */
async function checkBalance(orderId: string, stage: PayoutStage, amountKobo: Kobo): Promise<DispatchResult | null> {
  let available: Kobo;
  try {
    const b = await kora().getBalances();
    available = b.data.NGN?.available_balance ?? 0n;
  } catch (err) {
    if (!isKoraError(err)) throw err;
    const message = `Couldn't check the Kora balance before ${STAGE_LABEL[stage]}: ${err.userMessage}`;
    await transaction((tx) => orderEvent(tx, orderId, { kind: "error", title: `${STAGE_LABEL[stage]} not sent`, detail: message }));
    return { kind: "blocked", reason: "balance-unavailable", message };
  }
  if (available < amountKobo) {
    const message = `Insufficient funds in disbursement wallet. Kora balance is ${formatNaira(available)}; ${STAGE_LABEL[stage]} needs ${formatNaira(amountKobo)}.`;
    await transaction((tx) => orderEvent(tx, orderId, { kind: "error", title: `${STAGE_LABEL[stage]} not sent`, detail: message, amountKobo }));
    return { kind: "blocked", reason: "unfunded", message };
  }
  return null;
}

/** Kora requires a recipient email on every payout; refuse before writing anything. */
async function checkVendorEmail(orderId: string, stage: PayoutStage, email: string | null): Promise<DispatchResult | null> {
  if (email) return null;
  const message = "The vendor has no email on file, and Kora needs one to send a payout. Ask the vendor to add it.";
  await transaction((tx) => orderEvent(tx, orderId, { kind: "error", title: `${STAGE_LABEL[stage]} not sent`, detail: message }));
  return { kind: "blocked", reason: "vendor-email-missing", message };
}

/** Dispatch a stage's first payout. Idempotent: a second call finds the order already moved on. */
export async function dispatchStage(orderId: string, stage: PayoutStage, cause: Cause): Promise<DispatchResult> {
  const expected = stage === "STAGE_1" ? "HELD" : "CODE_VERIFIED";
  const pre = await db().order.findUnique({ where: { id: orderId }, include: { verification: true, vendor: true } });
  if (!pre) throw new NotFoundError("Order");
  if (pre.status !== expected) return { kind: "skipped", reason: `order is ${pre.status}` };

  const amountKobo = stageAmount(pre.amountKobo, stage);
  const blocked = (await checkVendorEmail(orderId, stage, pre.vendor.email)) ?? (await checkBalance(orderId, stage, amountKobo));
  if (blocked) return blocked;
  const dest = await chooseRoute(pre.verification);

  const payout = await transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (order.status !== expected) return null; // someone else dispatched while we checked the balance
    const created = await tx.payout.create({
      data: {
        orderId,
        verificationId: order.verificationId,
        stage,
        attempt: 1,
        reference: `PO-${orderId}-${STAGE_TAG[stage]}`,
        amountKobo,
        route: dest.route,
        destinationBankCode: dest.bank,
        destinationAccount: dest.account,
      },
    });
    await transition(tx, order, stage === "STAGE_1" ? "STAGE_1_PAID" : "RELEASED", { ...cause, note: created.reference });
    return created;
  });
  if (!payout) return { kind: "skipped", reason: "already dispatched" };
  return sendPayout(payout, cause);
}

/** Retry the most recent failed payout of a PAYOUT_FAILED order under a new reference. */
export async function retryPayout(orderId: string, cause: Cause): Promise<DispatchResult> {
  const pre = await db().order.findUnique({ where: { id: orderId }, include: { verification: true, vendor: true } });
  if (!pre) throw new NotFoundError("Order");
  if (pre.status !== "PAYOUT_FAILED") throw new DomainError("not_failed", "There is no failed payout to retry on this order.", 409);
  const failed = await db().payout.findFirst({ where: { orderId, status: "FAILED", retriedBy: null }, orderBy: { createdAt: "desc" } });
  if (!failed) throw new DomainError("not_failed", "There is no failed payout to retry on this order.", 409);

  const blocked = (await checkVendorEmail(orderId, failed.stage, pre.vendor.email)) ?? (await checkBalance(orderId, failed.stage, failed.amountKobo));
  if (blocked) return blocked;
  const dest = await chooseRoute(pre.verification);

  const payout = await transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (order.status !== "PAYOUT_FAILED") return null;
    const attempt = failed.attempt + 1;
    const created = await tx.payout.create({
      data: {
        orderId,
        verificationId: order.verificationId,
        stage: failed.stage,
        attempt,
        reference: `PO-${orderId}-${STAGE_TAG[failed.stage]}-R${attempt}`,
        amountKobo: failed.amountKobo,
        route: dest.route,
        destinationBankCode: dest.bank,
        destinationAccount: dest.account,
        retryOfId: failed.id,
      },
    });
    await transition(tx, order, retryTarget(failed.stage), { ...cause, note: `retry of ${failed.reference} as ${created.reference}` });
    return created;
  });
  if (!payout) return { kind: "skipped", reason: "already retried" };
  return sendPayout(payout, cause);
}

async function sendPayout(payout: Payout, cause: Cause): Promise<DispatchResult> {
  const order = await db().order.findUniqueOrThrow({ where: { id: payout.orderId }, include: { vendor: true } });
  const vendorEmail = order.vendor.email;
  if (!vendorEmail) throw new DomainError("vendor_email_missing", "The vendor has no email on file.", 409);
  const vendorName = order.vendor.name ?? order.vendor.label;
  const orderRef = `PA-${String(order.number).padStart(4, "0")}`;
  try {
    const res = await kora().disburse({
      reference: payout.reference,
      amountKobo: payout.amountKobo,
      bankCode: payout.destinationBankCode,
      accountNumber: payout.destinationAccount,
      narration: `ProcureAI ${orderRef} ${STAGE_LABEL[payout.stage].toLowerCase()}`,
      customer: { name: vendorName, email: vendorEmail },
      notificationUrl: env().KORA_WEBHOOK_URL,
      metadata: { orderId: order.id, stage: STAGE_TAG[payout.stage], attempt: String(payout.attempt) },
    });
    await transaction(async (tx) => {
      await tx.payout.update({ where: { id: payout.id }, data: { dispatchedAt: new Date(), feeKobo: res.data.fee ?? null, koraErrorKind: null } });
      await orderEvent(tx, payout.orderId, {
        kind: "info",
        title: `${STAGE_LABEL[payout.stage]} sent to Kora`,
        detail: `${formatNaira(payout.amountKobo)} to ${vendorName}${payout.route === "SANDBOX_TEST_ACCOUNT" ? ` · sandbox route ${payout.destinationBankCode}/${payout.destinationAccount}` : ""} · ${res.data.status}`,
        amountKobo: payout.amountKobo,
        koraReference: payout.reference,
        signature: "API",
      });
    });
    // Kora may answer with a final status straight away; otherwise the webhook/poller finishes it.
    if (res.data.status === "success" || res.data.status === "failed") {
      await applyPayoutOutcome(payout.reference, { status: res.data.status, message: res.data.message ?? null, feeKobo: res.data.fee ?? null, raw: res.raw }, cause);
    }
    return { kind: "sent", payout };
  } catch (err) {
    if (!isKoraError(err)) throw err;
    if (err.outcomeKnown) {
      await applyPayoutOutcome(
        payout.reference,
        { status: "failed", message: err.koraMessage ?? err.userMessage, feeKobo: null, raw: err.body ?? { error: err.toJSON() } },
        cause,
      );
      return { kind: "failed", payout, error: err };
    }
    await transaction(async (tx) => {
      await tx.payout.update({ where: { id: payout.id }, data: { koraErrorKind: err.kind } });
      await orderEvent(tx, payout.orderId, {
        kind: "info",
        title: `Checking ${STAGE_LABEL[payout.stage]} with Kora`,
        detail: `${err.userMessage} Reference ${payout.reference} stays pending until Kora confirms it.`,
        koraReference: payout.reference,
      });
    });
    log.warn({ reference: payout.reference, kind: err.kind }, "payout outcome unknown; left PENDING for the poller");
    return { kind: "pending-unknown", payout, error: err };
  }
}

export type PayoutOutcome = {
  status: "success" | "failed" | "processing" | "not_found";
  message: string | null;
  feeKobo: Kobo | null;
  raw: unknown;
};

/**
 * Applies Kora's answer about a payout under the order lock. PENDING → SUCCESS | FAILED exactly
 * once; every later answer is a no-op. Shared by the disburse response, the webhook worker, the
 * poller and the Re-check button.
 */
export async function applyPayoutOutcome(reference: string, outcome: PayoutOutcome, cause: Cause): Promise<{ changed: boolean }> {
  return transaction(async (tx) => {
    const found = await tx.payout.findUnique({ where: { reference }, select: { orderId: true } });
    if (!found) throw new UnknownReferenceError(reference);
    let order = await lockOrder(tx, found.orderId);
    const payout = await tx.payout.findUniqueOrThrow({ where: { reference }, include: { order: { include: { vendor: true } } } });

    if (cause.type !== "WEBHOOK") {
      await recordApiEvent(tx, {
        type: "transfer.query",
        reference,
        orderId: order.id,
        raw: outcome.raw,
        fingerprint: { reference, status: outcome.status, message: outcome.message },
      });
    }
    if (payout.status !== "PENDING" || outcome.status === "processing") return { changed: false };

    const vendorName = payout.order.vendor.name ?? payout.order.vendor.label;
    const signature = cause.type === "WEBHOOK" ? "VERIFIED" : "API";

    if (outcome.status === "success") {
      await tx.payout.update({
        where: { id: payout.id },
        data: { status: "SUCCESS", resolvedAt: new Date(), koraResponse: toJson(outcome.raw), feeKobo: outcome.feeKobo ?? payout.feeKobo },
      });
      await tx.ledgerEntry.createMany({
        data: [
          { orderId: order.id, account: "HELD", direction: "DEBIT", amountKobo: payout.amountKobo, koraReference: reference, sourceType: "PAYOUT", sourceId: payout.id },
          { orderId: order.id, account: "VENDOR_PAYOUT", direction: "CREDIT", amountKobo: payout.amountKobo, koraReference: reference, sourceType: "PAYOUT", sourceId: payout.id },
        ],
      });
      await orderEvent(tx, order.id, {
        kind: "kora",
        title: "transfer.success",
        detail: `${STAGE_LABEL[payout.stage]} to ${vendorName}`,
        amountKobo: payout.amountKobo,
        koraReference: reference,
        signature,
      });
      if (payout.stage === "STAGE_2" && order.status === "RELEASED") {
        order = await transition(tx, order, "COMPLETE", { ...cause, note: reference });
      }
      return { changed: true };
    }

    // failed, or Kora has no record of a payout whose dispatch never got an answer
    const reason =
      outcome.status === "not_found"
        ? "Kora has no record of this payout, so it was never sent."
        : (outcome.message ?? "Declined by receiving bank");
    await tx.payout.update({
      where: { id: payout.id },
      data: { status: "FAILED", resolvedAt: new Date(), failureReason: reason, koraResponse: toJson(outcome.raw) },
    });
    await orderEvent(tx, order.id, {
      kind: "kora",
      title: "transfer.failed",
      detail: `${STAGE_LABEL[payout.stage]} · ${reason}`,
      amountKobo: payout.amountKobo,
      koraReference: reference,
      signature,
    });
    if (canTransition(order.status, "PAYOUT_FAILED")) {
      order = await transition(tx, order, "PAYOUT_FAILED", { ...cause, note: `${reference}: ${reason}` });
    }
    return { changed: true };
  });
}

/**
 * The one entry point for "what does Kora say about this payout?". A signed webhook's status is
 * Kora's own statement; we still ask Kora, and only fall back to the webhook if the query is not
 * conclusive. `not_found` only counts once the payout is old enough that Kora should know it.
 */
export async function reconcilePayout(reference: string, cause: Cause, webhookStatus?: "success" | "failed"): Promise<{ changed: boolean }> {
  const payout = await db().payout.findUnique({ where: { reference } });
  if (!payout) throw new UnknownReferenceError(reference);
  let outcome: PayoutOutcome;
  try {
    const q = await kora().verifyPayout(reference);
    const s = q.data.status;
    outcome = {
      status: s === "success" || s === "failed" ? s : "processing",
      message: q.data.message ?? null,
      feeKobo: q.data.fee ?? null,
      raw: q.raw,
    };
  } catch (err) {
    if (!isKoraError(err)) throw err;
    const oldEnough = Date.now() - payout.createdAt.getTime() > 30_000;
    if (err.kind === "not_found" && oldEnough && !webhookStatus) {
      outcome = { status: "not_found", message: null, feeKobo: null, raw: err.body ?? { error: err.toJSON() } };
    } else if (webhookStatus) {
      outcome = { status: webhookStatus, message: null, feeKobo: null, raw: { source: "signed webhook", queryError: err.toJSON() } };
    } else {
      throw err;
    }
  }
  if (outcome.status === "processing" && webhookStatus) {
    outcome = { ...outcome, status: webhookStatus };
  }
  return applyPayoutOutcome(reference, outcome, cause);
}
