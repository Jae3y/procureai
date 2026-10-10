import type { Kobo } from "@/lib/money";

/**
 * Limits Kora enforces, each confirmed by a REAL Kora sandbox response (6 Oct 2026). The app
 * plans around them instead of hiding them; nothing here alters what Kora reports.
 */

/** POST /charges/bank-transfer: `{"amount":{"message":"amount must be less than or equal to 1000000"}}` (HTTP 422). */
export const KORA_MAX_CHARGE_KOBO: Kobo = 100_000_000n; // ₦1,000,000 per one-time account

/** POST /transactions/disburse: "You can only transfer an amount between NGN 1000 and NGN 10000000" (HTTP 409). */
export const KORA_MIN_PAYOUT_KOBO: Kobo = 100_000n; // ₦1,000
export const KORA_MAX_PAYOUT_KOBO: Kobo = 1_000_000_000n; // ₦10,000,000

/** POST /virtual-bank-account/sandbox/credit (docs): NGN 100 – NGN 10,000,000. */
export const KORA_MIN_SANDBOX_CREDIT_KOBO: Kobo = 10_000n;
export const KORA_MAX_SANDBOX_CREDIT_KOBO: Kobo = 1_000_000_000n;

/** How many one-time accounts a pay-in of `totalKobo` needs, given the per-charge ceiling. */
export function instalmentsFor(totalKobo: Kobo): number {
  const accounts = (totalKobo + KORA_MAX_CHARGE_KOBO - 1n) / KORA_MAX_CHARGE_KOBO; // a count, not money
  return Number(accounts);
}

/**
 * Kora's sandbox verifies one documented test business. Every vendor that passes a sandbox check
 * therefore comes back as this company; the UI says so instead of presenting it as the vendor's own record.
 */
export const KORA_SANDBOX_TEST_COMPANY = { rcNumber: "RC00000011", name: "John Doe Inc" } as const;
export function isSandboxTestCompany(rcNumber: string | null | undefined): boolean {
  return (rcNumber ?? "").toUpperCase().replace(/\s+/g, "") === KORA_SANDBOX_TEST_COMPANY.rcNumber;
}
