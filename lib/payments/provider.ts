import type { Kobo } from "@/lib/money";
import type { ProviderId } from "./errors";

/**
 * The contract between ProcureAI and a payment provider. The money path (pay-in, payouts, refunds,
 * the identity gate) talks only to this. Each provider gets one adapter in lib/payments/, and that
 * adapter is the only code allowed to know the provider's URLs, field names and quirks.
 *
 * Rules every adapter must keep (tests/integration/payment-provider-contract.test.ts checks them):
 *   • Amounts are integer kobo in and out. No floats, no naira.
 *   • A charge's credited amount comes from the provider's own query (`acceptedKobo`), never from a
 *     webhook body.
 *   • A refusal throws a ProviderError with outcomeKnown = true; anything uncertain throws one with
 *     outcomeKnown = false. Never turn an uncertain outcome into "failed".
 *   • References are ours and idempotent: re-using one must be refused (kind "duplicate_reference"),
 *     never treated as a second payment.
 *   • `raw` is the provider's response exactly as received, for the audit trail.
 *   • `metadata` carries 1–5 keys of letters, digits and '-', each key at most 20 characters (Kora's
 *     rule, the strictest we use). Callers always send at least the order id.
 */

export type WithRaw<T> = { data: T; raw: unknown };

export type Party = { name: string; email: string };

/** A one-time bank account the buyer transfers into. */
export type OpenedTransferAccount = {
  expectedKobo: Kobo;
  feeKobo: Kobo | null;
  accountNumber: string;
  accountName: string;
  bankName: string;
  expiresAt: Date | null;
};

/** What the provider says about a charge right now. */
export type ChargeSnapshot = {
  status: string;
  amountKobo: Kobo;
  paidKobo: Kobo | null;
  acceptedKobo: Kobo | null;
  feeKobo: Kobo | null;
  paymentEvent: string | null;
  message: string | null;
};

export type MoneyMovementStatus = "success" | "failed" | "processing";

export type PayoutAnswer = { status: MoneyMovementStatus; message: string | null; feeKobo: Kobo | null };

export type BusinessRecord = {
  reference: string;
  name: string;
  companyStatus: string | null;
  keyPersonnel: Array<{ name: string; designation?: string | null | undefined; status?: string | null | undefined }>;
};

export type BankAccountRecord = { reference: string; accountName: string };

export type ProviderLimits = {
  /** Largest amount one transfer account accepts; bigger orders are paid in instalments. */
  maxChargeKobo: Kobo;
  minPayoutKobo: Kobo;
  maxPayoutKobo: Kobo;
  minRefundKobo: Kobo;
};

export interface PaymentProvider {
  readonly id: ProviderId;
  /** The name shown to people, e.g. "Kora". */
  readonly name: string;
  readonly isTestMode: boolean;
  /** Test key against the provider's real sandbox API (payouts there only reach its test accounts). */
  readonly isLiveSandbox: boolean;
  /** Identity answers come from recorded fixtures instead of the provider. */
  readonly identitySimulated: boolean;
  readonly limits: ProviderLimits;

  openTransferAccount(input: {
    reference: string;
    amountKobo: Kobo;
    customer: Party;
    accountName: string;
    narration: string;
    metadata: Record<string, string>;
  }): Promise<WithRaw<OpenedTransferAccount>>;
  /** Hosted checkout page, where the provider offers one. */
  openCheckout(input: {
    reference: string;
    amountKobo: Kobo;
    customer: Party;
    narration: string;
    redirectUrl: string;
    metadata: Record<string, string>;
  }): Promise<WithRaw<{ checkoutUrl: string }>>;
  queryCharge(reference: string): Promise<WithRaw<ChargeSnapshot>>;

  sendPayout(input: {
    reference: string;
    amountKobo: Kobo;
    bankCode: string;
    accountNumber: string;
    narration: string;
    recipient: Party;
    metadata: Record<string, string>;
  }): Promise<WithRaw<PayoutAnswer>>;
  queryPayout(reference: string): Promise<WithRaw<PayoutAnswer>>;

  refund(input: { reference: string; paymentReference: string; amountKobo: Kobo; reason: string }): Promise<WithRaw<{ status: MoneyMovementStatus }>>;
  queryRefund(reference: string): Promise<WithRaw<{ status: MoneyMovementStatus }>>;

  /** The wallet payouts are paid from. */
  balance(): Promise<{ availableKobo: Kobo; pendingKobo: Kobo }>;
  banks(): Promise<{ banks: Array<{ name: string; code: string }>; source: string }>;

  verifyBusiness(input: { rcNumber: string; consent: boolean }): Promise<WithRaw<BusinessRecord>>;
  verifyBankAccount(input: { accountNumber: string; bankCode: string; consent: boolean }): Promise<WithRaw<BankAccountRecord>>;
}
