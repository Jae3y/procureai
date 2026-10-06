import { describe, expect, it } from "vitest";
import { KoraClient, kora } from "@/lib/kora/client";
import {
  KoraAccessError,
  KoraAuthError,
  KoraDuplicateReferenceError,
  KoraInsufficientFundsError,
  KoraNotFoundError,
  KoraSchemaError,
  KoraServerError,
  KoraTimeoutError,
  KoraValidationError,
} from "@/lib/kora/errors";
import { BankTransferChargeData, ChargeQueryData, CacData, WebhookPayload } from "@/lib/kora/schemas";
import { useKoraDouble } from "../helpers/kora";

const double = useKoraDouble({ timeoutMs: 300 });

const disburseInput = (reference: string, bankCode = "033") => ({
  reference,
  amountKobo: 10_000n,
  bankCode,
  accountNumber: "0000000000",
  narration: "t",
  customer: { name: "V", email: "v@procureai.test" },
  notificationUrl: "https://procureai.test/api/webhooks/kora",
  metadata: { orderId: "o1" },
});

describe("Kora client — parsing documented responses", () => {
  it("parses CAC, identity banks and bank-account-basic", async () => {
    const cac = await kora().verifyCac({ rcNumber: "rc00000011", consent: true });
    expect(cac.data.name).toBe("John Doe Inc");
    expect(cac.data.key_personnel.some((p) => p.name === "MICHAEL DOE" && p.designation === "DIRECTOR")).toBe(true);
    const sent = double.calls.find((c) => c.path === "/identities/ng/cac");
    expect(sent?.body).toEqual({ id: "00000011", registration_type: "RC", verification_consent: true });

    const acct = await kora().verifyBankAccountBasic({ accountNumber: "0123456789", bankCode: "058", consent: true });
    expect(acct.data.account_details.name).toBe("MICHAEL JOHN DOE");
  });

  const chargeInput = (reference: string, amountKobo: bigint) => ({
    reference,
    amountKobo,
    customer: { name: "T", email: "t@procureai.test" },
    accountName: "ProcureAI / PA-0001",
    narration: "n",
    notificationUrl: "https://procureai.test/api/webhooks/kora",
    metadata: { orderId: "o1" },
  });

  it("converts Kora's string and number money fields to kobo", async () => {
    const created = await kora().createBankTransferCharge(chargeInput("PA-test-0001", 100_000_000n));
    expect(created.data.amount).toBe(100_000_000n); // number 1000000 → kobo
    expect(created.data.fee).toBe(2_250n); // 22.5
    const sentBody = double.calls.find((c) => c.path === "/charges/bank-transfer")?.body as { amount: number };
    expect(sentBody.amount).toBe(1000000); // exact decimal on the wire

    const q = await kora().queryCharge("PA-test-0001");
    expect(q.data.amount).toBe(100_000_000n); // string "1000000.00" → kobo
    expect(q.data.amount_paid).toBe(0n);
  });

  it("refuses a bank-transfer charge above Kora's ₦1,000,000 per-account ceiling without calling Kora", async () => {
    const err = await kora().createBankTransferCharge(chargeInput("PA-test-0002", 100_000_001n)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RangeError);
    expect(double.callsTo("POST /charges/bank-transfer")).toBe(0);
  });
});

describe("Kora client — empty basic bank list (Kora's sandbox returns [])", () => {
  const fresh = () => new KoraClient({ baseUrl: double.baseUrl, secretKey: double.secretKey, simulateIdentity: false, sleep: async () => undefined });
  const emptyList = () => double.next("GET /identities/ng/banks", { status: 200, body: { status: true, message: "Banks fetched successfully", data: [] } });

  it("still verifies the account: the pre-check is skipped, Kora's own lookup decides", async () => {
    emptyList();
    const acct = await fresh().verifyBankAccountBasic({ accountNumber: "0123456789", bankCode: "058", consent: true });
    expect(acct.data.account_details.name).toBe("MICHAEL JOHN DOE");
    expect(double.callsTo("POST /identities/ng/bank-account-basic")).toBe(1);
  });

  it("the picker falls back to Kora's payout bank list and says so", async () => {
    emptyList();
    const list = await fresh().bankPickerList();
    expect(list.source).toBe("payout");
    expect(list.banks).toContainEqual({ name: "Guaranty Trust Bank", code: "058" });
  });

  it("an empty list isn't cached: a filled list is used on the next call", async () => {
    const client = fresh();
    emptyList();
    expect((await client.bankPickerList()).source).toBe("payout");
    expect((await client.bankPickerList()).source).toBe("identity");
    await expect(client.verifyBankAccountBasic({ accountNumber: "0123456789", bankCode: "999", consent: true })).rejects.toBeInstanceOf(KoraValidationError);
  });
});

describe("Kora client — retry policy", () => {
  it("retries a 5xx twice, then succeeds", async () => {
    double.next("GET /balances", { status: 502 });
    double.next("GET /balances", { status: 503 });
    const b = await kora().getBalances();
    expect(b.data.NGN?.available_balance).toBe(1_000_000_000n);
    expect(double.callsTo("GET /balances")).toBe(3);
  });

  it("gives up after 2 retries with KoraServerError (outcome unknown)", async () => {
    for (let i = 0; i < 3; i++) double.next("GET /balances", { status: 500 });
    const err = await kora().getBalances().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KoraServerError);
    expect((err as KoraServerError).outcomeKnown).toBe(false);
    expect(double.callsTo("GET /balances")).toBe(3);
  });

  it("never retries a 4xx", async () => {
    double.next("POST /identities/ng/cac", { status: 400, body: { status: false, error: "bad_request", message: "invalid request data", data: {} } });
    await expect(kora().verifyCac({ rcNumber: "RC00000011", consent: true })).rejects.toBeInstanceOf(KoraValidationError);
    expect(double.callsTo("POST /identities/ng/cac")).toBe(1);
  });

  it("never retries a payout, even on a 5xx", async () => {
    double.next("POST /transactions/disburse", { status: 500 });
    const err = await kora().disburse(disburseInput("PO-retry-test")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KoraServerError);
    expect(double.callsTo("POST /transactions/disburse")).toBe(1);
  });

  it("never retries a payout on timeout either, and reports the outcome as unknown", async () => {
    double.next("POST /transactions/disburse", { delayMs: 800 });
    const err = await kora().disburse(disburseInput("PO-timeout-test")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KoraTimeoutError);
    expect((err as KoraTimeoutError).outcomeKnown).toBe(false);
    expect(double.callsTo("POST /transactions/disburse")).toBe(1);
  });

  it("retries timeouts on safe reads", async () => {
    double.next("GET /balances", { delayMs: 800 });
    const b = await kora().getBalances();
    expect(b.httpStatus).toBe(200);
    expect(double.callsTo("GET /balances")).toBe(2);
  });
});

describe("Kora client — typed errors", () => {
  it("401 → KoraAuthError", async () => {
    const bad = new KoraClient({ baseUrl: double.baseUrl, secretKey: "sk_test_wrong", simulateIdentity: false, sleep: async () => undefined });
    await expect(bad.getBalances()).rejects.toBeInstanceOf(KoraAuthError);
  });

  it("403 or 'not enabled' → KoraAccessError", async () => {
    double.next("POST /identities/ng/cac", { status: 403, body: { status: false, message: "Forbidden", data: null } });
    await expect(kora().verifyCac({ rcNumber: "RC00000011", consent: true })).rejects.toBeInstanceOf(KoraAccessError);
    double.next("POST /charges/bank-transfer", { status: 400, body: { status: false, message: "Bank transfer via API has not been enabled for this merchant", data: null } });
    const err = await kora()
      .createBankTransferCharge({ reference: "PA-access-0001", amountKobo: 10_000n, customer: { name: "a", email: "a@b.co" }, accountName: "a", narration: "n", notificationUrl: "https://x.y/z", metadata: { a: "b" } })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KoraAccessError);
  });

  it("409s map to insufficient funds and duplicate reference", async () => {
    double.availableKobo = 0n;
    await expect(kora().disburse(disburseInput("PO-funds"))).rejects.toBeInstanceOf(KoraInsufficientFundsError);
    double.availableKobo = 1_000_000n;
    await kora().disburse(disburseInput("PO-dup"));
    await expect(kora().disburse(disburseInput("PO-dup"))).rejects.toBeInstanceOf(KoraDuplicateReferenceError);
  });

  it("404 → KoraNotFoundError; the invalid RC is a known outcome", async () => {
    const err = await kora().verifyCac({ rcNumber: "RC11111111", consent: true }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KoraNotFoundError);
    expect((err as KoraNotFoundError).outcomeKnown).toBe(true);
  });

  it("refuses identity calls without consent, without calling Kora", async () => {
    await expect(kora().verifyCac({ rcNumber: "RC00000011", consent: false })).rejects.toBeInstanceOf(KoraValidationError);
    expect(double.callsTo("POST /identities/ng/cac")).toBe(0);
  });

  it("rejects a premium bank code on the basic endpoint before any account lookup (lists differ)", async () => {
    const err = await kora().verifyBankAccountBasic({ accountNumber: "0123456789", bankCode: "000013", consent: true }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KoraValidationError);
    expect((err as KoraValidationError).koraMessage).toMatch(/not on Kora's basic verification list/);
    expect(double.callsTo("POST /identities/ng/bank-account-basic")).toBe(0);
  });

  it("rejects illegal metadata keys before calling Kora (Kora allows A-Z a-z 0-9 - only)", async () => {
    await expect(kora().disburse({ ...disburseInput("PO-meta"), metadata: { order_id: "x" } })).rejects.toThrow(/not allowed/);
    expect(double.callsTo("POST /transactions/disburse")).toBe(0);
  });

  it("a 2xx with the wrong shape is a KoraSchemaError with an unknown outcome", async () => {
    double.next("POST /transactions/disburse", { status: 200, body: { status: true, message: "ok", data: { reference: "PO-shape" } } });
    const err = await kora().disburse(disburseInput("PO-shape")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KoraSchemaError);
    expect((err as KoraSchemaError).outcomeKnown).toBe(false);
    expect((err as KoraSchemaError).issues.join(" ")).toMatch(/data\.status/);
  });
});

describe("Zod schemas reject malformed Kora payloads", () => {
  it.each([
    ["charge with no account", BankTransferChargeData, { reference: "r", currency: "NGN", amount: 1, status: "processing" }],
    ["charge in the wrong currency", BankTransferChargeData, { reference: "r", currency: "USD", amount: 1, status: "processing", bank_account: { account_name: "a", account_number: "1234567890", bank_name: "b" } }],
    ["query with a non-numeric amount", ChargeQueryData, { reference: "r", status: "success", amount: "abc", currency: "NGN" }],
    ["query with sub-kobo precision", ChargeQueryData, { reference: "r", status: "success", amount: "1.001", currency: "NGN" }],
    ["CAC with no reference", CacData, { name: "x" }],
    ["webhook with no reference", WebhookPayload, { event: "charge.success", data: { amount: 1 } }],
  ])("%s", (_label, schema, payload) => {
    expect(schema.safeParse(payload).success).toBe(false);
  });
});
