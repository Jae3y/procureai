import { inviteTokenFor } from "@/lib/crypto";
import { db } from "@/lib/db";
import { DomainError, NotFoundError } from "@/lib/domain/errors";
import { reconcileCharge } from "@/lib/domain/payin";
import { dispatchStage } from "@/lib/domain/payouts";
import { setSetting } from "@/lib/domain/settings";
import { submitQuote } from "@/lib/domain/vendors";
import { kora } from "@/lib/kora/client";
import { log } from "@/lib/log";
import type { Kobo } from "@/lib/money";
import { receiveKoraWebhook } from "@/lib/webhooks/receive";
import { processOutboxBatch } from "@/lib/worker/outbox";
import { tick } from "@/lib/worker/tick";
import { DEMO_VENDORS } from "./script";

/**
 * Admin demo controls (DEMO_MODE only). Each one either calls Kora's real sandbox API or feeds a
 * real input through ProcureAI's real code path. None of them writes order state directly.
 */

function sandboxOnly(): void {
  if (!kora().isTestMode) throw new DomainError("live_key", "Demo controls only work with a test-mode Kora key.", 403);
}

async function openPayIn(orderId: string) {
  const p = await db().payIn.findFirst({ where: { orderId, status: "PROCESSING" }, orderBy: { sequence: "desc" } });
  if (!p?.accountNumber) throw new DomainError("no_account", "This order has no open bank-transfer account to pay into.", 409);
  return p;
}

/** Pays the open one-time account with Kora's sandbox credit API (as a buyer's bank transfer would). */
export async function payAccount(orderId: string, amountKobo?: Kobo): Promise<{ credited: Kobo; account: string }> {
  sandboxOnly();
  const p = await openPayIn(orderId);
  const credited = amountKobo ?? p.amountExpectedKobo;
  await kora().sandboxCreditVirtualAccount({ accountNumber: p.accountNumber ?? "", amountKobo: credited });
  log.info({ orderId, reference: p.reference, credited: credited.toString() }, "demo: sandbox credit sent");
  return { credited, account: p.accountNumber ?? "" };
}

/** Pays ₦60,000 less than expected (the handoff's short state). */
export async function underpay(orderId: string): Promise<{ credited: Kobo; account: string }> {
  const p = await openPayIn(orderId);
  const short = p.amountExpectedKobo > 6_010_000n ? p.amountExpectedKobo - 6_000_000n : p.amountExpectedKobo / 2n;
  return payAccount(orderId, short);
}

export async function setPayoutRoute(route: "VERIFIED_ACCOUNT" | "SANDBOX_SUCCESS_033" | "SANDBOX_FAIL_035"): Promise<void> {
  if (route !== "VERIFIED_ACCOUNT") sandboxOnly();
  await setSetting("payoutRoute", route);
}

export async function suppressNextWebhook(): Promise<void> {
  await setSetting("suppressNextWebhook", "true");
}

/** Re-delivers a stored webhook byte-for-byte, as Kora's dashboard "Resend Webhook" would. */
export async function replayWebhook(eventId: string) {
  const e = await db().koraEvent.findUnique({ where: { id: eventId } });
  if (!e || e.source !== "WEBHOOK" || !e.rawBody) throw new NotFoundError("Stored webhook");
  const result = await receiveKoraWebhook({ rawBody: e.rawBody, signatureHeader: e.signatureHeader, demoNote: "Replayed from admin" });
  if (result.enqueued) await processOutboxBatch({ limit: 5 });
  return result;
}

/** Re-delivers a stored webhook with one hex digit of its signature flipped. */
export async function corruptSignature(eventId: string) {
  const e = await db().koraEvent.findUnique({ where: { id: eventId } });
  if (!e || e.source !== "WEBHOOK" || !e.rawBody || !e.signatureHeader) throw new NotFoundError("Stored signed webhook");
  const sig = e.signatureHeader;
  const flipped = `${sig.slice(0, -1)}${sig.endsWith("0") ? "1" : "0"}`;
  return receiveKoraWebhook({ rawBody: e.rawBody, signatureHeader: flipped, demoNote: "Signature corrupted from admin" });
}

export async function recheckNow(orderId: string) {
  const p = await db().payIn.findFirst({ where: { orderId }, orderBy: { sequence: "desc" } });
  if (p) await reconcileCharge(p.reference, { type: "ADMIN", id: "admin-recheck" });
  return tick();
}

export async function retryStage(orderId: string) {
  const o = await db().order.findUnique({ where: { id: orderId } });
  if (!o) throw new NotFoundError("Order");
  if (o.status === "HELD") return dispatchStage(orderId, "STAGE_1", { type: "ADMIN", id: "admin-retry" });
  if (o.status === "CODE_VERIFIED") return dispatchStage(orderId, "STAGE_2", { type: "ADMIN", id: "admin-retry" });
  throw new DomainError("nothing_to_send", "There is no stage waiting to be sent on this order.", 409);
}

/**
 * The scripted vendor replies, submitted through the SAME path as the vendor's phone
 * (submitQuote → normalizeQuote → Quote row), a beat apart so they arrive one by one.
 */
export async function deliverScriptedReplies(requestId: string, opts: { spacingMs?: number } = {}): Promise<void> {
  const request = await db().request.findUniqueOrThrow({ where: { id: requestId }, select: { item: true, quantity: true, budgetKobo: true } });
  const ask = { item: request.item, quantity: request.quantity, budgetKobo: request.budgetKobo };
  const vendors = await db().vendor.findMany({ where: { requestId }, include: { contact: true }, orderBy: { label: "asc" } });
  // Vendors answer when they like, not in a queue: start each a beat apart and let them run side by side.
  await Promise.all(
    vendors.map(async (v, i) => {
      const script = DEMO_VENDORS.find((d) => d.phone === v.contactPhone);
      const reply = script?.reply(ask);
      if (!script || reply === null || reply === undefined) return; // a silent vendor never writes back
      if (opts.spacingMs) await new Promise((r) => setTimeout(r, i * opts.spacingMs!));
      await submitQuote(inviteTokenFor(requestId, v.label), {
        reply,
        businessName: script.businessName,
        rcNumber: script.rcNumber,
        bankCode: script.bankCode,
        accountNumber: script.accountNumber,
        email: script.email,
        consent: true,
      });
    }),
  );
}
