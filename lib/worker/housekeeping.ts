import { db } from "@/lib/db";

/** Rows removed per table per pass, so one pass never holds a long lock or a long transaction. */
const BATCH = 1000;

export type HousekeepingReport = { rateLimits: number; idempotencyKeys: number; accountTokens: number };

/**
 * Deletes bookkeeping rows nothing can use any more, so these tables stay small as traffic grows and replies stored
 * for double-submit protection don't keep personal data longer than needed.
 *  - rate-limit counters: the longest window is one hour; a counter untouched for a day is dead.
 *  - idempotency keys: a client retries within minutes; after seven days the stored reply is only a privacy cost.
 *  - account tokens (email confirmation, password reset): useless once expired; kept seven days for support questions.
 */
export async function pruneHousekeeping(): Promise<HousekeepingReport> {
  const rateLimits = await db().$executeRaw`
    DELETE FROM "RateLimit" WHERE "key" IN (
      SELECT "key" FROM "RateLimit" WHERE "windowStart" < now() - interval '1 day' LIMIT ${BATCH})`;
  const idempotencyKeys = await db().$executeRaw`
    DELETE FROM "IdempotencyKey" WHERE "id" IN (
      SELECT "id" FROM "IdempotencyKey" WHERE "createdAt" < now() - interval '7 days' LIMIT ${BATCH})`;
  const accountTokens = await db().$executeRaw`
    DELETE FROM "AccountToken" WHERE "id" IN (
      SELECT "id" FROM "AccountToken" WHERE "expiresAt" < now() - interval '7 days' LIMIT ${BATCH})`;
  return { rateLimits, idempotencyKeys, accountTokens };
}
