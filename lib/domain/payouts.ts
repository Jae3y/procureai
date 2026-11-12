import { db, transaction, type Tx } from "@/lib/db";
import type { Payout, PayoutRoute, PayoutStage } from "@/lib/generated/prisma/client";
import { isProviderError, payments, providerFor, type PaymentProvider, type ProviderError } from "@/lib/payments";
import { log } from "@/lib/log";
import { formatNaira, type Kobo, splitStages } from "@/lib/money";
import { DomainError, NotFoundError, UnknownReferenceError } from "./errors";
import { payoutReference, splitIntoParts, stageIsPaid } from "./payout-parts";
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

const STAGE_TAG: Record<PayoutStage, "S1" | "S2"> = { STAGE_1: "S1", STAGE_2: "S2" };
const STAGE_LABEL: Record<PayoutStage, string> = { STAGE_1: "Stage 1", STAGE_2: "Stage 2" };

const SANDBOX_ACCOUNTS = {
  SANDBOX_SUCCESS_033: { bank: "033", account: "0000000000" },
  SANDBOX_FAIL_035: { bank: "035", account: "0000000000" },
} as const;

export type DispatchResult =
  | { kind: "sent"; payout: Payout }
  | { kind: "pending-unknown"; payout: Payout; error: ProviderError }
  | { kind: "failed"; payout: Payout; error: ProviderError }
  | { kind: "blocked"; reason: "unfunded" | "balance-unavailable" | "vendor-email-missing"; message: string }
  | { kind: "skipped"; reason: string };

function stageAmount(totalKobo: Kobo, stage: PayoutStage): Kobo {
  const { stage1, stage2 } = splitStages(totalKobo);
  return stage === "STAGE_1" ? stage1 : stage2;
}

async function chooseRoute(provider: PaymentProvider, verification: { bankCode: string; accountNumber: string }): Promise<{ route: PayoutRoute; bank: string; account: string }> {
  const setting = await getSetting("payoutRoute");
  if (setting !== "VERIFIED_ACCOUNT" && provider.isTestMode) {
    const s = SANDBOX_ACCOUNTS[setting];
    return { route: "SANDBOX_TEST_ACCOUNT", bank: s.bank, account: s.account };
  }
  // Against the real Kora sandbox (test key, real API), disbursements to non-sandbox test accounts
  // are rejected with "Invalid account." Automatically route to Kora's 033 success account.
  if (provider.isLiveSandbox) {
    return { route: "SANDBOX_TEST_ACCOUNT", bank: "033", account: "0000000000" };
  }
  return { route: "VERIFIED_ACCOUNT", bank: verification.bankCode, account: verification.accountNumber };
}

/**
 * "Check the Kora balance before Stage 1 and show a precise error if unfunded." Done before every
 * dispatch; a failed check blocks the payout (nothing is written) and says exactly why.
 */
async function checkBalance(provider: PaymentProvider, orderId: string, stage: PayoutStage, amountKobo: Kobo): Promise<DispatchResult | null> {
  let available: Kobo;
  try {
    available = (await provider.balance()).availableKobo;
  } catch (err) {
    if (!isProviderError(err)) throw err;
    const message = `Couldn't check the payout balance before ${STAGE_LABEL[stage]}: ${err.userMessage}`;
    await transaction((tx) => orderEvent(tx, orderId, { kind: "error", title: `${STAGE_LABEL[stage]} not sent`, detail: message }));
    return { kind: "blocked", reason: "balance-unavailable", message };
  }
  if (available < amountKobo) {
    const message = `Insufficient funds in disbursement wallet. Payout balance is ${formatNaira(available)}; ${STAGE_LABEL[stage]} needs ${formatNaira(amountKobo)}.`;
    await transaction((tx) => orderEvent(tx, orderId, { kind: "error", title: `${STAGE_LABEL[stage]} not sent`, detail: message, amountKobo }));
    return { kind: "blocked", reason: "unfunded", message };
  }
  return null;
}

/** Kora requires a recipient email on every payout; refuse before writing anything. */
async function checkVendorEmail(orderId: string, stage: PayoutStage, email: string | null): Promise<DispatchResult | null> {
  if (email) return null;
  const message = "The vendor has no email on file, and one is needed to send a payout. Ask the vendor to add it.";
  await transaction((tx) => orderEvent(tx, orderId, { kind: "error", title: `${STAGE_LABEL[stage]} not sent`, detail: message }));
  return { kind: "blocked", reason: "vendor-email-missing", message };
}

/**
 * Dispatch a stage. A stage within the provider's per-transfer maximum is one payout; a bigger one is several
 * ("parts"), all written under the same order lock as the state change and then sent one by one. Idempotent:
 * a second call finds the order already moved on.
 */
export async function dispatchStage(orderId: string, stage: PayoutStage, cause: Cause): Promise<DispatchResult> {
  const expected = stage === "STAGE_1" ? "HELD" : "CODE_VERIFIED";
  const pre = await db().order.findUnique({ where: { id: orderId }, include: { verification: true, vendor: true } });
  if (!pre) throw new NotFoundError("Order");
  if (pre.status !== expected) return { kind: "skipped", reason: `order is ${pre.status}` };

  const amountKobo = stageAmount(pre.amountKobo, stage);
  const provider = payments();
  const parts = splitIntoParts(amountKobo, provider.limits.maxPayoutKobo);
  const blocked = (await checkVendorEmail(orderId, stage, pre.vendor.email)) ?? (await checkBalance(provider, orderId, stage, amountKobo));
  if (blocked) return blocked;
  const dest = await chooseRoute(provider, pre.verification);

  const created = await transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (order.status !== expected) return null; // someone else dispatched while we checked the balance
    const rows: Payout[] = [];
    for (const [i, part] of parts.entries()) {
      rows.push(
        await tx.payout.create({
          data: {
            orderId,
            verificationId: order.verificationId,
            stage,
            part: i + 1,
            attempt: 1,
            reference: payoutReference(orderId, STAGE_TAG[stage], i + 1, 1),
            provider: provider.id,
            amountKobo: part,
            route: dest.route,
            destinationBankCode: dest.bank,
            destinationAccount: dest.account,
          },
        }),
      );
    }
    const first = rows[0] as Payout;
    await transition(tx, order, stage === "STAGE_1" ? "STAGE_1_PAID" : "RELEASED", {
      ...cause,
      note: rows.length > 1 ? `${first.reference} and ${rows.length - 1} more parts` : first.reference,
    });
    return rows;
  });
  if (!created) return { kind: "skipped", reason: "already dispatched" };
  return sendParts(created, cause);
}

/** True when every part of Stage 1 has landed with the vendor (one part is not enough). */
export async function stage1IsPaid(tx: Tx, orderId: string, orderAmountKobo: Kobo): Promise<boolean> {
  const rows = await tx.payout.findMany({ where: { orderId, stage: "STAGE_1" }, select: { stage: true, status: true, amountKobo: true } });
  return stageIsPaid(rows, "STAGE_1", splitStages(orderAmountKobo).stage1);
}

/** Sends every part of a stage. All are attempted; the answer reports the most important outcome (failed, then unknown, then sent). */
async function sendParts(rows: Payout[], cause: Cause): Promise<DispatchResult> {
  const results: DispatchResult[] = [];
  for (const row of rows) results.push(await sendPayout(row, cause, rows.length));
  return results.find((r) => r.kind === "failed") ?? results.find((r) => r.kind === "pending-unknown") ?? (results[0] as DispatchResult);
}

/**
 * Retry the failed payout parts of a PAYOUT_FAILED order's stage, each under a new reference. Parts that
 * already landed, or are still being confirmed, are left alone: a retry never pays anything twice.
 */
export async function retryPayout(orderId: string, cause: Cause): Promise<DispatchResult> {
  const pre = await db().order.findUnique({ where: { id: orderId }, include: { verification: true, vendor: true } });
  if (!pre) throw new NotFoundError("Order");
  if (pre.status !== "PAYOUT_FAILED") throw new DomainError("not_failed", "There is no failed payout to retry on this order.", 409);
  const latest = await db().payout.findFirst({ where: { orderId, status: "FAILED", retriedBy: null }, orderBy: { createdAt: "desc" } });
  if (!latest) throw new DomainError("not_failed", "There is no failed payout to retry on this order.", 409);
  const failedParts = await db().payout.findMany({ where: { orderId, stage: latest.stage, status: "FAILED", retriedBy: null }, orderBy: { part: "asc" } });
  const needed = failedParts.reduce((a, p) => a + p.amountKobo, 0n);

  const provider = payments();
  const blocked = (await checkVendorEmail(orderId, latest.stage, pre.vendor.email)) ?? (await checkBalance(provider, orderId, latest.stage, needed));
  if (blocked) return blocked;
  const dest = await chooseRoute(provider, pre.verification);

  const created = await transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (order.status !== "PAYOUT_FAILED") return null;
    const rows: Payout[] = [];
    for (const failed of failedParts) {
      const attempt = failed.attempt + 1;
      rows.push(
        await tx.payout.create({
          data: {
            orderId,
            verificationId: order.verificationId,
            stage: failed.stage,
            part: failed.part,
            attempt,
            reference: payoutReference(orderId, STAGE_TAG[failed.stage], failed.part, attempt),
            provider: provider.id,
            amountKobo: failed.amountKobo,
            route: dest.route,
            destinationBankCode: dest.bank,
            destinationAccount: dest.account,
            retryOfId: failed.id,
          },
        }),
      );
    }
    await transition(tx, order, retryTarget(latest.stage), {
      ...cause,
      note: `retry of ${failedParts.map((f) => f.reference).join(", ")} as ${rows.map((r) => r.reference).join(", ")}`,
    });
    return rows;
  });
  if (!created) return { kind: "skipped", reason: "already retried" };
  return sendParts(created, cause);
}

async function sendPayout(payout: Payout, cause: Cause, partCount = 1): Promise<DispatchResult> {
  const order = await db().order.findUniqueOrThrow({ where: { id: payout.orderId }, include: { vendor: true } });
  const vendorEmail = order.vendor.email;
  if (!vendorEmail) throw new DomainError("vendor_email_missing", "The vendor has no email on file.", 409);
  const vendorName = order.vendor.name ?? order.vendor.label;
  const orderRef = `PA-${String(order.number).padStart(4, "0")}`;
  const provider = providerFor(payout.provider);
  try {
    const res = await provider.sendPayout({
      reference: payout.reference,
      amountKobo: payout.amountKobo,
      bankCode: payout.destinationBankCode,
      accountNumber: payout.destinationAccount,
      narration: `ProcureAI ${orderRef} ${STAGE_LABEL[payout.stage].toLowerCase()}${partCount > 1 ? ` part ${payout.part}/${partCount}` : ""}`,
      recipient: { name: vendorName, email: vendorEmail },
      metadata: { orderId: order.id, stage: STAGE_TAG[payout.stage], attempt: String(payout.attempt), part: String(payout.part) },
    });
    await transaction(async (tx) => {
      await tx.payout.update({ where: { id: payout.id }, data: { dispatchedAt: new Date(), feeKobo: res.data.feeKobo, koraErrorKind: null } });
      await orderEvent(tx, payout.orderId, {
        kind: "info",
        title: `${STAGE_LABEL[payout.stage]} sent`,
        detail: `${formatNaira(payout.amountKobo)} to ${vendorName}${payout.route === "SANDBOX_TEST_ACCOUNT" ? ` · sandbox route ${payout.destinationBankCode}/${payout.destinationAccount}` : ""} · ${res.data.status}`,
        amountKobo: payout.amountKobo,
        koraReference: payout.reference,
        signature: "API",
      });
    });
    // The provider may answer with a final status straight away; otherwise the webhook/poller finishes it.
    if (res.data.status !== "processing") {
      await applyPayoutOutcome(payout.reference, { ...res.data, raw: res.raw }, cause);
    }
    return { kind: "sent", payout };
  } catch (err) {
    if (!isProviderError(err)) throw err;
    if (err.outcomeKnown) {
      await applyPayoutOutcome(
        payout.reference,
        { status: "failed", message: err.providerMessage ?? err.userMessage, feeKobo: null, raw: err.body ?? { error: err.toJSON() } },
        cause,
      );
      return { kind: "failed", payout, error: err };
    }
    await transaction(async (tx) => {
      await tx.payout.update({ where: { id: payout.id }, data: { koraErrorKind: err.kind } });
      await orderEvent(tx, payout.orderId, {
        kind: "info",
        title: `Confirming ${STAGE_LABEL[payout.stage]}`,
        detail: `${err.userMessage} Reference ${payout.reference} stays pending until it is confirmed.`,
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
        // The order is complete only when every part of the last stage has landed, not when one has.
        const stage2Parts = await tx.payout.findMany({ where: { orderId: order.id, stage: "STAGE_2" }, select: { stage: true, status: true, amountKobo: true } });
        if (stageIsPaid(stage2Parts, "STAGE_2", stageAmount(order.amountKobo, "STAGE_2"))) {
          order = await transition(tx, order, "COMPLETE", { ...cause, note: reference });
        }
      }
      return { changed: true };
    }

    // failed, or Kora has no record of a payout whose dispatch never got an answer
    const reason =
      outcome.status === "not_found"
        ? "The payment provider has no record of this payout, so it was never sent."
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
    const q = await providerFor(payout.provider).queryPayout(reference);
    outcome = { ...q.data, raw: q.raw };
  } catch (err) {
    if (!isProviderError(err)) throw err;
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
