import { sha256Hex } from "@/lib/crypto";
import { db, transaction } from "@/lib/db";
import { toJson } from "@/lib/domain/kora-events";
import { consumeSuppressNextWebhook } from "@/lib/domain/settings";
import { orderEvent } from "@/lib/domain/timeline";
import { env } from "@/lib/env";
import { WebhookPayload } from "@/lib/kora/schemas";
import { extractRawDataSpan, verifyKoraSignature } from "@/lib/kora/signature";
import { log } from "@/lib/log";
import { formatNaira } from "@/lib/money";

/**
 * Store-then-process. Every delivery is persisted — including invalid signatures (admin shows them
 * red) — and only a valid, non-duplicate one gets an Outbox row. Nothing here changes order state;
 * the outbox worker does that under the order lock.
 *
 * I6 dedupe key: (event type, reference, sha256(signatureValid + raw `data` bytes)). Folding the
 * signature verdict into the hash means a forged copy that arrives first can never shadow the
 * genuine delivery.
 */

export type ReceiveResult = {
  eventId: string | null;
  signatureValid: boolean;
  duplicate: boolean;
  enqueued: boolean;
  note: string;
};

const MAX_BODY = 256 * 1024;

async function orderIdForReference(reference: string): Promise<string | null> {
  const [payIn, payout] = await Promise.all([
    db().payIn.findUnique({ where: { reference }, select: { orderId: true } }),
    db().payout.findUnique({ where: { reference }, select: { orderId: true } }),
  ]);
  return payIn?.orderId ?? payout?.orderId ?? null;
}

export async function receiveKoraWebhook(input: { rawBody: string; signatureHeader: string | null; demoNote?: string }): Promise<ReceiveResult> {
  const rawBody = input.rawBody.length > MAX_BODY ? input.rawBody.slice(0, MAX_BODY) : input.rawBody;
  const check = verifyKoraSignature(rawBody, input.signatureHeader, env().KORA_SECRET_KEY);
  const signatureValid = check.valid;

  let json: unknown = null;
  try {
    json = JSON.parse(rawBody);
  } catch {
    json = { unparseable: rawBody.slice(0, 2000) };
  }
  const parsed = WebhookPayload.safeParse(json);
  const type = parsed.success ? parsed.data.event : "unparseable";
  const reference = parsed.success ? parsed.data.data.reference : `unknown-${sha256Hex(rawBody).slice(0, 12)}`;
  const idempotencyHash = sha256Hex(`${signatureValid ? 1 : 0}:${extractRawDataSpan(rawBody) ?? rawBody}`);
  const orderId = parsed.success ? await orderIdForReference(reference) : null;

  const suppressed = signatureValid && parsed.success && (await consumeSuppressNextWebhook());
  const shouldProcess = signatureValid && parsed.success && !suppressed;
  const demoNote = suppressed ? "Suppressed by demo control: stored, not processed" : (input.demoNote ?? null);

  return transaction(async (tx) => {
    const inserted = await tx.koraEvent.createMany({
      data: [
        {
          type,
          reference,
          source: "WEBHOOK",
          signatureValid,
          signatureMethod: check.valid ? check.method : check.reason,
          idempotencyHash,
          payload: toJson(json),
          rawBody,
          signatureHeader: input.signatureHeader,
          orderId,
          demoNote,
          processedAt: shouldProcess ? null : new Date(),
          processError: signatureValid ? null : `signature ${check.valid ? "ok" : check.reason}`,
        },
      ],
      skipDuplicates: true,
    });
    const event = await tx.koraEvent.findUniqueOrThrow({
      where: { type_reference_idempotencyHash: { type, reference, idempotencyHash } },
    });
    const amount = parsed.success ? (parsed.data.data.amount ?? null) : null;

    if (inserted.count === 0) {
      log.info({ eventId: event.id, type, reference }, "duplicate webhook ignored");
      if (orderId) {
        await orderEvent(tx, orderId, {
          kind: "info",
          title: "Duplicate webhook ignored",
          detail: `${type} for ${reference} was already received`,
          koraReference: reference,
          signature: signatureValid ? "VERIFIED" : "INVALID",
        });
      }
      return { eventId: event.id, signatureValid, duplicate: true, enqueued: false, note: "duplicate" };
    }

    if (!signatureValid) {
      log.warn({ eventId: event.id, type, reference, reason: check.valid ? null : check.reason }, "webhook signature INVALID; stored, no state change");
      if (orderId) {
        await orderEvent(tx, orderId, {
          kind: "kora",
          title: type,
          detail: `Rejected: signature ${check.valid ? "" : check.reason}. No money moved.`,
          amountKobo: amount,
          koraReference: reference,
          signature: "INVALID",
        });
      }
      return { eventId: event.id, signatureValid, duplicate: false, enqueued: false, note: "invalid signature" };
    }

    if (suppressed && orderId) {
      await orderEvent(tx, orderId, {
        kind: "info",
        title: "Webhook suppressed (demo)",
        detail: `${type}${amount !== null ? ` ${formatNaira(amount)}` : ""} was received and stored but not acted on. The poller or Re-check will find it.`,
        koraReference: reference,
      });
    }

    if (shouldProcess) await tx.outbox.create({ data: { eventId: event.id } });
    return {
      eventId: event.id,
      signatureValid,
      duplicate: false,
      enqueued: shouldProcess,
      note: suppressed ? "suppressed" : shouldProcess ? "enqueued" : "unparseable",
    };
  });
}
