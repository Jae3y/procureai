import { randomInt, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { UnknownReferenceError } from "@/lib/domain/errors";
import { reconcileCharge } from "@/lib/domain/payin";
import { reconcilePayout } from "@/lib/domain/payouts";
import { reconcileRefund } from "@/lib/domain/refunds";
import type { KoraEvent } from "@/lib/generated/prisma/client";
import { isKoraError } from "@/lib/kora/errors";
import { WebhookPayload } from "@/lib/kora/schemas";
import { log, withLogContext } from "@/lib/log";

/**
 * Outbox worker: claims due rows with FOR UPDATE SKIP LOCKED (so any number of workers can run),
 * processes each event under the order lock (inside the domain services), and on failure backs off
 * exponentially with jitter. After 5 attempts the event is parked with processError, which the
 * admin screen surfaces in red.
 */

export const MAX_ATTEMPTS = 5;

class NonRetryable extends Error {}

/** 2s, 4s, 8s, 16s (+ up to 1s jitter). */
export function backoffMs(attempts: number): number {
  return 1000 * 2 ** attempts + randomInt(0, 1000);
}

export async function processKoraEvent(event: KoraEvent): Promise<string> {
  const parsed = WebhookPayload.safeParse(event.payload);
  if (!parsed.success) throw new NonRetryable("payload does not match Kora's webhook shape");
  const { event: type, data } = parsed.data;
  const cause = { type: "WEBHOOK" as const, id: event.id };

  if (type.startsWith("charge.")) {
    if (!data.reference.startsWith("PA-")) return "not a ProcureAI charge reference; recorded only";
    const r = await reconcileCharge(data.reference, cause);
    return r.changed ? "charge applied" : "charge already applied";
  }
  if (type.startsWith("transfer.")) {
    if (!data.reference.startsWith("PO-")) return "not a ProcureAI payout reference; recorded only";
    const status = type === "transfer.success" ? "success" : type === "transfer.failed" ? "failed" : undefined;
    const r = await reconcilePayout(data.reference, cause, status);
    return r.changed ? "payout applied" : "payout already applied";
  }
  if (type.startsWith("refund.")) {
    if (!data.reference.startsWith("RF-")) return "not a ProcureAI refund reference; recorded only";
    const status = type === "refund.success" ? "success" : type === "refund.failed" ? "failed" : undefined;
    const r = await reconcileRefund(data.reference, cause, status);
    return r.changed ? "refund applied" : "refund already applied";
  }
  return `${type} recorded; ProcureAI does not act on it`;
}

type Claimed = { id: string; eventId: string; attempts: number };

export async function processOutboxBatch(opts: { limit?: number } = {}): Promise<{ processed: number; retried: number; parked: number }> {
  const workerId = `w_${randomUUID().slice(0, 8)}`;
  const limit = opts.limit ?? 20;
  const claimed = await db().$queryRaw<Claimed[]>`
    UPDATE "Outbox" SET "lockedAt" = now(), "lockedBy" = ${workerId}
    WHERE "id" IN (
      SELECT "id" FROM "Outbox"
      WHERE "doneAt" IS NULL AND "nextAttemptAt" <= now()
        AND ("lockedAt" IS NULL OR "lockedAt" < now() - interval '2 minutes')
      ORDER BY "createdAt"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED)
    RETURNING "id", "eventId", "attempts"`;

  let processed = 0;
  let retried = 0;
  let parked = 0;
  for (const row of claimed) {
    const event = await db().koraEvent.findUniqueOrThrow({ where: { id: row.eventId } });
    await withLogContext({ orderId: event.orderId ?? undefined }, async () => {
      try {
        const note = await processKoraEvent(event);
        const orderId =
          event.orderId ??
          (await db().payIn.findUnique({ where: { reference: event.reference }, select: { orderId: true } }))?.orderId ??
          (await db().payout.findUnique({ where: { reference: event.reference }, select: { orderId: true } }))?.orderId ??
          null;
        await db().$transaction([
          db().outbox.update({ where: { id: row.id }, data: { doneAt: new Date(), attempts: row.attempts + 1, lockedAt: null, lastError: null } }),
          db().koraEvent.update({ where: { id: event.id }, data: { processedAt: new Date(), processError: null, orderId } }),
        ]);
        log.info({ eventId: event.id, type: event.type, reference: event.reference, note }, "outbox event processed");
        processed++;
      } catch (err) {
        const attempts = row.attempts + 1;
        const message = isKoraError(err) ? `${err.name}: ${err.message}` : err instanceof Error ? err.message : String(err);
        const permanent = err instanceof NonRetryable || attempts >= MAX_ATTEMPTS;
        log.warn({ eventId: event.id, attempts, permanent, err: message, unknownRef: err instanceof UnknownReferenceError }, "outbox event failed");
        if (permanent) {
          await db().$transaction([
            db().outbox.update({ where: { id: row.id }, data: { attempts, doneAt: new Date(), lockedAt: null, lastError: message } }),
            db().koraEvent.update({ where: { id: event.id }, data: { processError: `gave up after ${attempts} attempt(s): ${message}` } }),
          ]);
          parked++;
        } else {
          await db().outbox.update({
            where: { id: row.id },
            data: { attempts, lockedAt: null, lastError: message, nextAttemptAt: new Date(Date.now() + backoffMs(attempts)) },
          });
          retried++;
        }
      }
    });
  }
  return { processed, retried, parked };
}

/** Process one specific event right after the webhook response (best effort; the tick also covers it). */
export async function processOutboxSoon(): Promise<void> {
  await processOutboxBatch({ limit: 5 });
}
