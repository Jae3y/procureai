import { db } from "@/lib/db";
import { DomainError } from "@/lib/domain/errors";

/**
 * Fixed-window rate limit kept in Postgres, so it holds across serverless instances. One atomic
 * upsert per hit: the window resets in the same statement that counts.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<void> {
  const rows = await db().$queryRaw<Array<{ count: number; windowStart: Date }>>`
    INSERT INTO "RateLimit" ("key", "windowStart", "count") VALUES (${key}, now(), 1)
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."windowStart" < now() - make_interval(secs => ${windowSeconds}) THEN 1 ELSE "RateLimit"."count" + 1 END,
      "windowStart" = CASE WHEN "RateLimit"."windowStart" < now() - make_interval(secs => ${windowSeconds}) THEN now() ELSE "RateLimit"."windowStart" END
    RETURNING "count", "windowStart"`;
  const row = rows[0];
  if (row && row.count > limit) {
    const retryAfter = Math.max(1, Math.ceil((row.windowStart.getTime() + windowSeconds * 1000 - Date.now()) / 1000));
    throw new DomainError("rate_limited", `Too many attempts. Try again in ${retryAfter} seconds.`, 429, { retryAfter });
  }
}
