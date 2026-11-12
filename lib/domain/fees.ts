import type { Kobo } from "@/lib/money";

/**
 * ProcureAI's fees (revenue model v2, in procureai-notes/docs/internal/MARKETPLACE-PLAN.md). NOT connected to any payment yet:
 * these are pure functions with tests, so the numbers can be checked and tuned before a single naira is charged.
 * Turning fees on also needs the pay-in, refund and ledger changes, and the payment provider's written rate card.
 *
 * All amounts are integer kobo. Fees are rounded to the nearest whole naira so buyers and sellers see clean numbers.
 */

/** Buyer protection fee: tax-style bands, so each rate applies only to the slice of the order inside its band. No cap. */
export const BUYER_BANDS: ReadonlyArray<{ upToKobo: Kobo | null; rateBp: number }> = [
  { upToKobo: 10_000_000n, rateBp: 400 }, // first ₦100,000: 4%
  { upToKobo: 100_000_000n, rateBp: 250 }, // up to ₦1,000,000: 2.5%
  { upToKobo: 1_000_000_000n, rateBp: 150 }, // up to ₦10,000,000: 1.5%
  { upToKobo: null, rateBp: 100 }, // above that: 1%
];
export const MIN_BUYER_FEE_KOBO = 30_000n; // ₦300
/** ProcureAI Plus halves only the first band (4% → 2%), so a member saves at most ₦2,000 an order, however large the order. */
export const PLUS_FIRST_BAND_RATE_BP = 200;
export const SELLER_FEE_BP = 200; // 2% of what the seller is paid
export const FOUNDING_SELLER_FREE_MONTHS = 6;
export const PLUS_PRICE_MONTHLY_KOBO = 300_000n; // ₦3,000
export const PLUS_PRICE_YEARLY_KOBO = 3_000_000n; // ₦30,000

const NAIRA = 100n;

function roundToNaira(kobo: bigint): bigint {
  return ((kobo + NAIRA / 2n) / NAIRA) * NAIRA;
}

function rateOf(bp: number, kobo: bigint): bigint {
  return (kobo * BigInt(bp) + 5_000n) / 10_000n; // half-up
}

export function buyerProtectionFee(orderKobo: Kobo, opts: { plus?: boolean } = {}): Kobo {
  if (orderKobo <= 0n) return 0n;
  let fee = 0n;
  let from = 0n;
  for (const [i, band] of BUYER_BANDS.entries()) {
    const to = band.upToKobo === null || orderKobo < band.upToKobo ? orderKobo : band.upToKobo;
    if (to > from) {
      const bp = opts.plus && i === 0 ? PLUS_FIRST_BAND_RATE_BP : band.rateBp;
      fee += rateOf(bp, to - from);
    }
    if (band.upToKobo === null || orderKobo <= band.upToKobo) break;
    from = band.upToKobo;
  }
  const rounded = roundToNaira(fee);
  return rounded < MIN_BUYER_FEE_KOBO ? MIN_BUYER_FEE_KOBO : rounded;
}

/** What the seller pays on a payout. Founding sellers pay nothing for their first months. */
export function sellerFee(payoutKobo: Kobo, opts: { foundingUntil?: Date | null; now?: Date } = {}): Kobo {
  if (payoutKobo <= 0n) return 0n;
  if (opts.foundingUntil && opts.foundingUntil > (opts.now ?? new Date())) return 0n;
  return roundToNaira(rateOf(SELLER_FEE_BP, payoutKobo));
}

export function foundingFeeHolidayEnds(registeredAt: Date): Date {
  const d = new Date(registeredAt);
  d.setUTCMonth(d.getUTCMonth() + FOUNDING_SELLER_FREE_MONTHS);
  return d;
}

/** The most Plus saves a member on one order. Used to check the subscription pays for itself: ₦3,000 covers two such orders. */
export function plusSavingOnOrder(orderKobo: Kobo): Kobo {
  return buyerProtectionFee(orderKobo) - buyerProtectionFee(orderKobo, { plus: true });
}
