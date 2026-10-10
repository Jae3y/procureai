import { z } from "zod";
import { decimalToKobo, jsonNumberToKobo, MoneyError } from "@/lib/money";

/**
 * Zod schemas for every Kora payload we read. Field names and shapes come from
 * Kora's docs (checked against the sandbox, 5 Oct 2026). Unknown fields are stripped from the parsed view;
 * the untouched raw JSON is stored alongside for I8.
 */

/** Kora money: a JSON number (22.5) or a decimal string ("100.00") → bigint kobo. */
export const KoraMoney = z.union([z.number(), z.string()]).transform((v, ctx) => {
  try {
    return typeof v === "number" ? jsonNumberToKobo(v) : decimalToKobo(v);
  } catch (e) {
    ctx.addIssue({ code: "custom", message: e instanceof MoneyError ? e.message : "invalid money value" });
    return z.NEVER;
  }
});

/** Status strings vary in case across endpoints; compare lower-cased. */
const Status = z.string().transform((s) => s.toLowerCase());

/** Shape of a Kora error body. Every field optional: errors are not uniformly documented. */
export const KoraErrorBody = z.object({
  status: z.boolean().optional(),
  message: z.string().optional(),
  code: z.string().optional(),
  error: z.string().optional(),
  data: z.unknown().optional(),
});

// ── Identity ────────────────────────────────────────────────────────────────

export const KeyPerson = z.object({
  name: z.string(),
  designation: z.string().nullish(),
  status: z.string().nullish(),
});

export const CacData = z.object({
  reference: z.string().min(1),
  id: z.string().nullish(),
  name: z.string().min(1),
  registration_number: z.string().nullish(),
  company_status: z.string().nullish(),
  key_personnel: z.array(KeyPerson).nullish().transform((v) => v ?? []),
});
export type CacData = z.infer<typeof CacData>;

export const IdentityBank = z.object({ name: z.string(), code: z.string().min(1) });
export const IdentityBanks = z.array(IdentityBank);
export type IdentityBank = z.infer<typeof IdentityBank>;

export const BankAccountBasicData = z.object({
  reference: z.string().min(1),
  id: z.string().nullish(),
  id_type: z.string().nullish(),
  bank_details: z.object({ name: z.string().nullish(), code: z.string() }),
  account_details: z.object({ number: z.string(), name: z.string().min(1) }),
});
export type BankAccountBasicData = z.infer<typeof BankAccountBasicData>;

export const VerificationQueryData = z.object({
  reference: z.string(),
  status: Status.nullish(),
  type: z.string().nullish(),
  identity_type: z.string().nullish(),
  date_created: z.string().nullish(),
});

// ── Pay-in ──────────────────────────────────────────────────────────────────

export const BankTransferChargeData = z.object({
  reference: z.string().min(1),
  payment_reference: z.string().nullish(),
  currency: z.literal("NGN"),
  amount: KoraMoney,
  amount_expected: KoraMoney.nullish(),
  fee: KoraMoney.nullish(),
  vat: KoraMoney.nullish(),
  status: Status,
  merchant_bears_cost: z.boolean().nullish(),
  bank_account: z.object({
    account_name: z.string(),
    account_number: z.string().min(6),
    bank_name: z.string(),
    bank_code: z.string().nullish(),
    expiry_date_in_utc: z.string().nullish(),
  }),
});
export type BankTransferChargeData = z.infer<typeof BankTransferChargeData>;

export const ChargeQueryData = z.object({
  reference: z.string().min(1),
  status: Status,
  amount: KoraMoney,
  amount_paid: KoraMoney.nullish(),
  amount_accepted: KoraMoney.nullish(),
  fee: KoraMoney.nullish(),
  currency: z.string(),
  bank_transfer: z
    .object({
      payment_event: z.string().nullish(),
      message: z.string().nullish(),
      reversal: z
        .object({ status: z.string().nullish(), amount: KoraMoney.nullish() })
        .nullish(),
    })
    .nullish(),
});
export type ChargeQueryData = z.infer<typeof ChargeQueryData>;

export const CheckoutInitData = z.object({ reference: z.string(), checkout_url: z.url() });

// ── Payout ──────────────────────────────────────────────────────────────────

export const DisburseData = z.object({
  reference: z.string().min(1),
  status: Status,
  amount: KoraMoney,
  fee: KoraMoney.nullish(),
  currency: z.string().nullish(),
  message: z.string().nullish(),
});
export type DisburseData = z.infer<typeof DisburseData>;

export const PayoutQueryData = z.object({
  reference: z.string().min(1),
  status: Status,
  amount: KoraMoney,
  fee: KoraMoney.nullish(),
  currency: z.string().nullish(),
  message: z.string().nullish(),
  trace_id: z.string().nullish(),
});
export type PayoutQueryData = z.infer<typeof PayoutQueryData>;

export const PayoutBank = z.object({
  name: z.string(),
  slug: z.string().nullish(),
  code: z.string().min(1),
  nibss_bank_code: z.string().nullish(),
  country: z.string().nullish(),
});
export const PayoutBanks = z.array(PayoutBank);

// ── Refunds ─────────────────────────────────────────────────────────────────

export const RefundInitData = z.object({
  refund_reference: z.string().nullish(),
  reference: z.string().nullish(),
  status: Status,
  payment_reference: z.string().nullish(),
  amount_returned: KoraMoney.nullish(),
  currency: z.string().nullish(),
});

export const RefundQueryData = z.object({
  reference: z.string(),
  status: Status,
  amount: KoraMoney.nullish(),
  payment_reference: z.string().nullish(),
  reason: z.string().nullish(),
});

// ── Balance ─────────────────────────────────────────────────────────────────

export const CurrencyBalance = z.object({
  pending_balance: KoraMoney,
  available_balance: KoraMoney,
  issuing_balance: KoraMoney.nullish(),
});
export const Balances = z.record(z.string(), CurrencyBalance);
export type Balances = z.infer<typeof Balances>;

export const BalanceHistoryEntry = z
  .object({
    pointer: z.string().nullish(),
    amount: KoraMoney,
    currency: z.string(),
    balance_before: KoraMoney,
    balance_after: KoraMoney,
    date: z.string().nullish(),
    date_created: z.string().nullish(),
    description: z.string().nullish(),
    direction: z.enum(["debit", "credit"]),
    source: z.string().nullish(),
    source_reference: z.string().nullish(),
  })
  .transform(({ date, date_created, ...rest }) => ({ ...rest, date: date ?? date_created ?? null }));
export type BalanceHistoryEntry = z.infer<typeof BalanceHistoryEntry>;

/**
 * Kora documents two shapes for balance history :
 *   Postman: { status, message, data: { has_more, history: [...] } }
 *   Guide:   { has_more, data: { ...one entry } }
 */
export const BalanceHistoryResponse = z
  .union([
    z.object({
      status: z.literal(true),
      data: z.object({ has_more: z.boolean(), history: z.array(BalanceHistoryEntry) }),
    }),
    z.object({
      has_more: z.boolean(),
      data: z.union([z.array(BalanceHistoryEntry), BalanceHistoryEntry]),
    }),
  ])
  .transform((r) => {
    if ("history" in r.data) return { hasMore: r.data.has_more, entries: r.data.history };
    const hasMore = "has_more" in r ? r.has_more : false;
    return { hasMore, entries: Array.isArray(r.data) ? r.data : [r.data] };
  });

// ── Webhooks ────────────────────────────────────────────────────────────────

export const WEBHOOK_EVENTS = [
  "charge.success",
  "charge.failed",
  "transfer.success",
  "transfer.failed",
  "refund.success",
  "refund.failed",
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];

export const WebhookPayload = z.object({
  event: z.string().min(1),
  data: z.object({
    reference: z.string().min(1),
    payment_reference: z.string().nullish(),
    amount: KoraMoney.nullish(),
    fee: KoraMoney.nullish(),
    currency: z.string().nullish(),
    status: Status.nullish(),
    batch_reference: z.string().nullish(),
  }),
});
export type WebhookPayload = z.infer<typeof WebhookPayload>;
