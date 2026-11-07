import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { reconcileCharge } from "@/lib/domain/payin";
import { isProviderError, payments, providerFor, type PaymentProvider, type ProviderError } from "@/lib/payments";
import { koraProvider } from "@/lib/payments/kora";
import { makeRequest } from "../helpers/factories";
import { useKoraDouble } from "../helpers/kora";

/**
 * THE PROVIDER CONTRACT. Every payment provider ProcureAI can use must pass this suite before it
 * touches real money. Each entry supplies the provider plus the sandbox controls a test needs to
 * play the payer and to make the provider misbehave. Kora runs against the local Kora test double;
 * a new provider adds an entry that runs against its own sandbox.
 */

type Harness = {
  provider: PaymentProvider;
  /** The buyer transfers `kobo` into the account behind `reference`. */
  pay(reference: string, kobo: bigint): void;
  /** The provider's next payout call times out or errors on its side. */
  breakNextPayout(how: "server-error" | "timeout"): void;
  testCompany: { rcNumber: string; name: string };
  bank: { code: string; accountNumber: string };
};

const kora = useKoraDouble({ timeoutMs: 300 });

const HARNESSES: Array<{ name: string; make: () => Harness }> = [
  {
    name: "Kora",
    make: () => ({
      provider: koraProvider,
      pay: (reference, kobo) => {
        kora.pay(reference, kobo);
      },
      breakNextPayout: (how) => kora.next("POST /transactions/disburse", how === "timeout" ? { delayMs: 1_000 } : { status: 500 }),
      testCompany: { rcNumber: "RC00000011", name: "John Doe Inc" },
      bank: { code: "058", accountNumber: "0123456789" },
    }),
  },
];

let seq = 0;
const ref = (tag: string) => `CT-${tag}-${Date.now().toString(36)}-${seq++}`;
const customer = { name: "Ada Obi", email: "ada@example.com" };

async function refusal(promise: Promise<unknown>): Promise<ProviderError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(isProviderError(err), `expected a ProviderError, got ${String(err)}`).toBe(true);
  return err as ProviderError;
}

for (const { name, make } of HARNESSES) {
  describe(`payment provider contract · ${name}`, () => {
    it("states its limits in integer kobo, coherently", () => {
      const { provider } = make();
      for (const v of Object.values(provider.limits)) expect(typeof v).toBe("bigint");
      expect(provider.limits.minPayoutKobo).toBeLessThan(provider.limits.maxPayoutKobo);
      expect(provider.limits.maxChargeKobo).toBeGreaterThan(0n);
    });

    it("opens a transfer account and reports what was accepted from its own query", async () => {
      const h = make();
      const reference = ref("charge");
      const opened = await h.provider.openTransferAccount({ reference, amountKobo: 50_000_00n, customer, accountName: "ProcureAI / test", narration: "contract", metadata: { test: "1" } });
      expect(opened.data.expectedKobo).toBeGreaterThanOrEqual(50_000_00n);
      expect(opened.data.accountNumber).toMatch(/^\d{10}$/);
      expect(opened.raw).toBeTruthy();

      const before = await h.provider.queryCharge(reference);
      expect(before.data.status).not.toBe("success");

      h.pay(reference, 30_000_00n); // short
      const after = await h.provider.queryCharge(reference);
      expect(typeof after.data.amountKobo).toBe("bigint");
      expect(after.data.paidKobo).toBe(30_000_00n);
      if (after.data.acceptedKobo !== null) expect(after.data.acceptedKobo).toBeLessThanOrEqual(30_000_00n);
    });

    it("refuses a re-used charge reference as a known refusal, never a second payment", async () => {
      const { provider } = make();
      const reference = ref("dup");
      const input = { reference, amountKobo: 10_000_00n, customer, accountName: "ProcureAI / test", narration: "contract", metadata: { test: "1" } };
      await provider.openTransferAccount(input);
      const err = await refusal(provider.openTransferAccount(input));
      expect(err).toMatchObject({ kind: "duplicate_reference", outcomeKnown: true });
    });

    it("pays out, answers about the payout, and refuses the same payout reference twice", async () => {
      const h = make();
      const reference = ref("payout");
      const input = { reference, amountKobo: 20_000_00n, bankCode: h.bank.code, accountNumber: h.bank.accountNumber, narration: "contract", recipient: customer, metadata: { test: "1" } };
      const sent = await h.provider.sendPayout(input);
      expect(["success", "failed", "processing"]).toContain(sent.data.status);
      const q = await h.provider.queryPayout(reference);
      expect(["success", "failed", "processing"]).toContain(q.data.status);
      const err = await refusal(h.provider.sendPayout(input));
      expect(err).toMatchObject({ kind: "duplicate_reference", outcomeKnown: true });
    });

    it("never reports an uncertain payout as failed: a timeout or server error leaves the outcome unknown", async () => {
      const h = make();
      for (const how of ["server-error", "timeout"] as const) {
        h.breakNextPayout(how);
        const err = await refusal(
          h.provider.sendPayout({ reference: ref(how), amountKobo: 20_000_00n, bankCode: h.bank.code, accountNumber: h.bank.accountNumber, narration: "contract", recipient: customer, metadata: { test: "1" } }),
        );
        expect(err.outcomeKnown, how).toBe(false);
      }
    });

    it("refunds a paid charge and answers about the refund", async () => {
      const h = make();
      const payment = ref("paid");
      await h.provider.openTransferAccount({ reference: payment, amountKobo: 10_000_00n, customer, accountName: "ProcureAI / test", narration: "contract", metadata: { test: "1" } });
      h.pay(payment, 10_000_00n);
      const reference = ref("refund");
      const r = await h.provider.refund({ reference, paymentReference: payment, amountKobo: 5_000_00n, reason: "contract" });
      expect(["success", "failed", "processing"]).toContain(r.data.status);
      expect(["success", "failed", "processing"]).toContain((await h.provider.queryRefund(reference)).data.status);
    });

    it("reports its payout balance and bank list", async () => {
      const { provider } = make();
      const b = await provider.balance();
      expect(typeof b.availableKobo).toBe("bigint");
      const { banks } = await provider.banks();
      expect(banks.length).toBeGreaterThan(0);
      for (const bank of banks) expect(bank.code).toMatch(/^\d{3,6}$/);
    });

    it("verifies a registered business and its bank account, and refuses an unknown one as a known answer", async () => {
      const h = make();
      const biz = await h.provider.verifyBusiness({ rcNumber: h.testCompany.rcNumber, consent: true });
      expect(biz.data.name).toBe(h.testCompany.name);
      expect(Array.isArray(biz.data.keyPersonnel)).toBe(true);
      const acct = await h.provider.verifyBankAccount({ accountNumber: h.bank.accountNumber, bankCode: h.bank.code, consent: true });
      expect(acct.data.accountName.length).toBeGreaterThan(0);
      const err = await refusal(h.provider.verifyBusiness({ rcNumber: "RC99999999", consent: true }));
      expect(err.outcomeKnown).toBe(true);
    });
  });
}

describe("payments stay with the provider that took them", () => {
  it("new payments use the configured provider, and the stored provider decides who is asked later", async () => {
    expect(payments().id).toBe("kora");
    expect(providerFor("kora")).toBe(koraProvider);
    expect(() => providerFor("nobody")).toThrow(/Unknown payment provider/);
  });

  it("a stored payment from an unknown provider is never silently checked with the default one", async () => {
    const request = await makeRequest();
    const { makeOrderFixture } = await import("../helpers/factories");
    const f = await makeOrderFixture();
    await db().payIn.create({
      data: { orderId: f.order.id, sequence: 99, reference: `PA-${request.id}-X`, provider: "nobody", channel: "bank_transfer", amountRequestedKobo: 100n, amountExpectedKobo: 100n, koraResponse: {} },
    });
    await expect(reconcileCharge(`PA-${request.id}-X`, { type: "POLLER", id: "contract" })).rejects.toThrow(/Unknown payment provider/);
  });
});
