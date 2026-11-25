import { db } from "@/lib/db";
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
  "An account is activated on the Africa/Lagos day it creates its first real (non-demo) purchase request.";

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

/** Accounts opened through the vendor registration form are vendors, counted in vendor_signups, not signups. */
const NOT_VENDOR_FORM = { OR: [{ signupMethod: null }, { signupMethod: { not: "vendor" } }] };

export async function growthStats(day: string, now: Date = new Date()): Promise<GrowthStats> {
  const { start, end } = lagosDayRange(day);
  const inDay = { gte: start, lt: end };

  const [newAccounts, vendorSignups, users, vendors, activationRows, purchaseRows, totalsRows] = await Promise.all([
    db().account.findMany({
      where: { createdAt: inDay, ...NOT_VENDOR_FORM },
      select: { signupMethod: true, googleSub: true, passwordHash: true, utmSource: true, heardFrom: true, referrerHost: true },
    }),
    db().vendorContact.count({ where: { registeredAt: inDay, isDemo: false } }),
    db().account.count({ where: NOT_VENDOR_FORM }),
    db().vendorContact.count({ where: { registeredAt: { not: null }, isDemo: false } }),
    db().$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM (
        SELECT min(r."createdAt") AS first_at
        FROM "Account" a JOIN "Request" r ON r."buyerId" = a."buyerId"
        WHERE r."isDemo" = false
        GROUP BY a.id
      ) t
      WHERE t.first_at >= ${start} AND t.first_at < ${end}`,
    db().$queryRaw<Array<{ n: number; minor: bigint }>>`
      SELECT count(*)::int AS n, coalesce(sum(o."amountKobo"), 0)::bigint AS minor
      FROM "Order" o
      JOIN "Request" r ON r.id = o."requestId"
      JOIN (SELECT "orderId", min("at") AS held_at FROM "OrderTransition" WHERE "toState" = 'HELD' GROUP BY "orderId") h ON h."orderId" = o.id
      WHERE r."isDemo" = false AND h.held_at >= ${start} AND h.held_at < ${end}`,
    db().$queryRaw<Array<{ activated: number; paying: number }>>`
      SELECT
        (SELECT count(DISTINCT a.id)::int FROM "Account" a JOIN "Request" r ON r."buyerId" = a."buyerId" WHERE r."isDemo" = false) AS activated,
        (SELECT count(DISTINCT a.id)::int FROM "Account" a
           JOIN "Request" r ON r."buyerId" = a."buyerId"
           JOIN "Order" o ON o."requestId" = r.id
         WHERE r."isDemo" = false
           AND EXISTS (SELECT 1 FROM "OrderTransition" t WHERE t."orderId" = o.id AND t."toState" = 'HELD')) AS paying`,
  ]);

  const byMethod = { email: 0, google: 0 };
  const bySource: Record<string, number> = {};
  for (const a of newAccounts) {
    // Accounts from before signupMethod was kept: a Google account with no password was opened with Google.
    const method = a.signupMethod === "google" || (a.signupMethod === null && a.googleSub && !a.passwordHash) ? "google" : "email";
    byMethod[method] += 1;
    const source = a.utmSource ?? a.heardFrom?.toLowerCase() ?? a.referrerHost ?? "unknown";
    bySource[source] = (bySource[source] ?? 0) + 1;
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
    signups_by_source: bySource,
    vendor_signups: vendorSignups,
    activations: activationRows[0]?.n ?? 0,
    activation_definition: ACTIVATION_DEFINITION,
    purchases: purchaseRows[0]?.n ?? 0,
    revenue_minor: Number(revenue),
    currency: "NGN",
    payments_mode: e.koraMode === "test" || e.DEMO_MODE ? "test" : "live",
    totals: { users, activated_users: totalsRows[0]?.activated ?? 0, paying_customers: totalsRows[0]?.paying ?? 0, vendors },
    generated_at: now.toISOString(),
  };
}
