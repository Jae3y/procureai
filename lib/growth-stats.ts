import { db } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { env } from "@/lib/env";

/**
 * Daily growth numbers for the owner's local Growth Engine (GET /api/internal/growth-stats). Aggregate counts only:
 * nothing here may ever carry an email, name, phone or id. The same JSON shape is served by every product.
 */

export const TIMEZONE = "Africa/Lagos";
/** Lagos is UTC+1 all year (no daylight saving). */
const LAGOS_OFFSET_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const ACTIVATION_DEFINITION =
  "A buyer account (not one opened by the vendor registration form) is activated on the Africa/Lagos day it creates its first real (non-demo) purchase request.";

export type GrowthStats = {
  product: "procureai";
  date: string;
  timezone: typeof TIMEZONE;
  signups: number;
  signups_by_method: { email: number; google: number };
  signups_by_source: Record<string, number>;
  vendor_signups: number;
  activations: number;
  activation_definition: string;
  purchases: number;
  revenue_minor: number;
  currency: "NGN";
  payments_mode: "live" | "test";
  totals: { users: number; activated_users: number; paying_customers: number; vendors: number };
  generated_at: string;
};

/** A real calendar date in YYYY-MM-DD form (2026-02-30 is refused), or null. */
export function parseDay(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value ? value : null;
}

/** Yesterday, as a calendar date in Lagos. */
export function yesterdayInLagos(now: Date): string {
  return new Date(now.getTime() + LAGOS_OFFSET_MS - DAY_MS).toISOString().slice(0, 10);
}

/** The Lagos calendar day as a UTC instant range [start, end): 00:00 in Lagos is 23:00 UTC the evening before. */
export function lagosDayRange(day: string): { start: Date; end: Date } {
  const start = new Date(new Date(`${day}T00:00:00Z`).getTime() - LAGOS_OFFSET_MS);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

/**
 * The people counted in signups, users, activations and paying customers: every account except those opened for a
 * vendor profile (counted once, in vendor_signups). Accounts from before signupMethod was kept are recognised by shape:
 * a vendor-form account had a vendor profile, no Google id and no "buy/sell" answer, which the buyer form always asks.
 */
const BUYER_ACCOUNT = Prisma.sql`(a."signupMethod" IS DISTINCT FROM 'vendor'
  AND NOT (a."signupMethod" IS NULL AND a."vendorContactId" IS NOT NULL AND a."googleSub" IS NULL AND a."intent" IS NULL))`;

type NewAccount = { signupMethod: string | null; google: boolean; utmSource: string | null; heardFrom: string | null; referrerHost: string | null };

/** A source key the endpoint may show: a short tag. Anything else (a long string, or a run of digits like a phone number) is "other". */
export function sourceKey(a: Pick<NewAccount, "utmSource" | "heardFrom" | "referrerHost">): string {
  const raw = a.utmSource ?? a.heardFrom?.toLowerCase() ?? a.referrerHost;
  if (!raw) return "unknown";
  return /^[a-z][a-z0-9._-]{0,31}$/.test(raw) && !/\d{5,}/.test(raw) ? raw : "other";
}

export async function growthStats(day: string, now: Date = new Date()): Promise<GrowthStats> {
  const { start, end } = lagosDayRange(day);

  // One snapshot for every count, so a sign-up or payment landing mid-read can't show in one number and not another.
  const { newAccounts, vendorSignups, vendors, accountRows, purchaseRows } = await db().$transaction(
    async (tx) => {
      const newAccounts = await tx.$queryRaw<NewAccount[]>`
        SELECT a."signupMethod", (a."googleSub" IS NOT NULL AND a."passwordHash" IS NULL) AS google, a."utmSource", a."heardFrom", a."referrerHost"
        FROM "Account" a
        WHERE a."createdAt" >= ${start} AND a."createdAt" < ${end} AND ${BUYER_ACCOUNT}`;
      const vendorSignups = await tx.vendorContact.count({ where: { registeredAt: { gte: start, lt: end }, isDemo: false } });
      const vendors = await tx.vendorContact.count({ where: { registeredAt: { not: null }, isDemo: false } });
      // Per buyer account: when its first real request was made, and whether any real order of its reached HELD.
      const accountRows = await tx.$queryRaw<Array<{ users: number; activations: number; activated: number; paying: number }>>`
        WITH acc AS (
          SELECT a.id,
            (SELECT min(r."createdAt") FROM "Request" r WHERE r."buyerId" = a."buyerId" AND r."isDemo" = false) AS first_request_at,
            EXISTS (
              SELECT 1 FROM "Request" r JOIN "Order" o ON o."requestId" = r.id
              WHERE r."buyerId" = a."buyerId" AND r."isDemo" = false
                AND EXISTS (SELECT 1 FROM "OrderTransition" t WHERE t."orderId" = o.id AND t."toState" = 'HELD')
            ) AS paid
          FROM "Account" a
          WHERE ${BUYER_ACCOUNT}
        )
        SELECT count(*)::int AS users,
          count(*) FILTER (WHERE first_request_at >= ${start} AND first_request_at < ${end})::int AS activations,
          count(first_request_at)::int AS activated,
          count(*) FILTER (WHERE paid)::int AS paying
        FROM acc`;
      const purchaseRows = await tx.$queryRaw<Array<{ n: number; minor: bigint }>>`
        SELECT count(*)::int AS n, coalesce(sum(o."amountKobo"), 0)::bigint AS minor
        FROM "Order" o
        JOIN "Request" r ON r.id = o."requestId"
        JOIN (SELECT "orderId", min("at") AS held_at FROM "OrderTransition" WHERE "toState" = 'HELD' GROUP BY "orderId") h ON h."orderId" = o.id
        WHERE r."isDemo" = false AND h.held_at >= ${start} AND h.held_at < ${end}`;
      return { newAccounts, vendorSignups, vendors, accountRows, purchaseRows };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15_000 },
  );

  const byMethod = { email: 0, google: 0 };
  const bySource = new Map<string, number>();
  for (const a of newAccounts) {
    // Accounts from before signupMethod was kept: a Google account with no password was opened with Google.
    const method = a.signupMethod === "google" || (a.signupMethod === null && a.google) ? "google" : "email";
    byMethod[method] += 1;
    const source = sourceKey(a);
    bySource.set(source, (bySource.get(source) ?? 0) + 1);
  }

  // The contract wants a JSON number. The sum stays exact BigInt until here, and is refused rather than rounded if it
  // ever outgrew a safe integer (about ₦90 trillion).
  const revenue = purchaseRows[0]?.minor ?? 0n;
  if (revenue > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("revenue_minor is too large to send as an exact JSON number");

  const e = env();
  return {
    product: "procureai",
    date: day,
    timezone: TIMEZONE,
    signups: newAccounts.length,
    signups_by_method: byMethod,
    signups_by_source: Object.fromEntries(bySource),
    vendor_signups: vendorSignups,
    activations: accountRows[0]?.activations ?? 0,
    activation_definition: ACTIVATION_DEFINITION,
    purchases: purchaseRows[0]?.n ?? 0,
    revenue_minor: Number(revenue),
    currency: "NGN",
    payments_mode: e.koraMode === "test" || e.DEMO_MODE ? "test" : "live",
    totals: { users: accountRows[0]?.users ?? 0, activated_users: accountRows[0]?.activated ?? 0, paying_customers: accountRows[0]?.paying ?? 0, vendors },
    generated_at: now.toISOString(),
  };
}
