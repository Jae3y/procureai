import { randomInt } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import bankAccountBasic058 from "@/lib/kora/fixtures/documented/bank-account-basic-058-0123456789.json";
import banksBasic from "@/lib/kora/fixtures/documented/banks-basic-basic.json";
import cacValid from "@/lib/kora/fixtures/documented/cac-RC00000011.json";
import { decimalToKobo, koboToNairaDecimal } from "@/lib/money";
import { signLikeKora } from "@/lib/kora/signature";

/**
 * TEST-ONLY stand-in for api.korapay.com, used by the unit/integration suites so they are fast and
 * deterministic. Every response body copies a shape from Kora's docs (docs/kora-snapshots/); the
 * sandbox suite (tests/sandbox) runs the same flows against the real Kora sandbox.
 *
 * Never imported by application code — tests/unit/boundaries.test.ts asserts that.
 */

type Override = { status?: number; body?: unknown; delayMs?: number; times?: number };
type ChargeState = {
  reference: string;
  expectedKobo: bigint;
  paidKobo: bigint;
  acceptedKobo: bigint;
  status: "processing" | "success" | "failed" | "expired";
  accountNumber: string;
  paymentEvent: "underpayment" | "overpayment" | null;
};
type PayoutState = { reference: string; amountKobo: bigint; status: "processing" | "success" | "failed"; message: string | null; bank: string; account: string };

export type Preference = "accept_all" | "return_excess" | "return_all";

export class KoraDouble {
  readonly secretKey: string;
  private server: Server | undefined;
  baseUrl = "";
  calls: Array<{ method: string; path: string; body: unknown }> = [];
  charges = new Map<string, ChargeState>();
  payouts = new Map<string, PayoutState>();
  availableKobo = 1_000_000_000n; // ₦10,000,000
  /** How Kora's under/overpayment preference is configured on the merchant's dashboard. */
  preference: Preference = "accept_all";
  /** Include amount_accepted in charge queries (Kora's Postman success example omits it). */
  includeAccepted = true;
  /** Payouts settle immediately on query (sandbox behaviour) unless set false. */
  settlePayoutsOnQuery = true;
  /** When set (offline dev mode), the double POSTs signed webhooks here, as Kora does. */
  webhookTarget: string | null = null;
  private overrides = new Map<string, Override[]>();

  constructor(secretKey = process.env.KORA_SECRET_KEY ?? "sk_test_procureai_unit_tests_only") {
    this.secretKey = secretKey;
  }

  async start(listenPort = 0): Promise<string> {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server?.listen(listenPort, "127.0.0.1", resolve));
    const { port } = this.server.address() as AddressInfo;
    this.baseUrl = `http://127.0.0.1:${port}/merchant/api/v1`;
    return this.baseUrl;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  reset(): void {
    this.calls = [];
    this.charges.clear();
    this.payouts.clear();
    this.overrides.clear();
    this.availableKobo = 1_000_000_000n;
    this.preference = "accept_all";
    this.includeAccepted = true;
    this.settlePayoutsOnQuery = true;
  }

  /** Make the next `times` calls matching "METHOD /path-prefix" answer differently. */
  next(route: string, o: Override): void {
    const list = this.overrides.get(route) ?? [];
    list.push({ times: 1, ...o });
    this.overrides.set(route, list);
  }

  callsTo(route: string): number {
    const [method, prefix] = route.split(" ") as [string, string];
    return this.calls.filter((c) => c.method === method && c.path.startsWith(prefix)).length;
  }

  // ── helpers tests use to play the role of the payer / Kora's webhook sender ──

  /** Sandbox credit, as Kora would apply it given the merchant's preference. */
  pay(reference: string, kobo: bigint): ChargeState {
    const c = this.charges.get(reference);
    if (!c) throw new Error(`no charge ${reference}`);
    c.paidKobo += kobo;
    if (c.paidKobo === c.expectedKobo) {
      c.status = "success";
      c.acceptedKobo = c.paidKobo;
      c.paymentEvent = null;
    } else if (c.paidKobo < c.expectedKobo) {
      c.paymentEvent = "underpayment";
      if (this.preference === "accept_all") {
        c.status = "success";
        c.acceptedKobo = c.paidKobo;
      }
    } else {
      c.paymentEvent = "overpayment";
      c.status = "success";
      c.acceptedKobo = this.preference === "accept_all" ? c.paidKobo : c.expectedKobo;
    }
    if (c.status === "success") this.availableKobo += c.acceptedKobo;
    return c;
  }

  /** A webhook body + signature exactly as Kora signs it (HMAC of JSON.stringify(data)). */
  webhook(event: string, data: Record<string, unknown>, opts: { tamper?: boolean } = {}): { rawBody: string; signature: string } {
    const signature = signLikeKora(data, this.secretKey);
    const sent = opts.tamper ? { ...data, amount: Number(data.amount ?? 0) + 1 } : data;
    return { rawBody: JSON.stringify({ event, data: sent }), signature };
  }

  chargeWebhook(reference: string, opts: { tamper?: boolean; event?: "charge.success" | "charge.failed" } = {}) {
    const c = this.charges.get(reference);
    if (!c) throw new Error(`no charge ${reference}`);
    // Per Kora: the webhook amount is the amount REQUESTED, whatever was actually paid.
    return this.webhook(opts.event ?? "charge.success", {
      reference,
      currency: "NGN",
      amount: Number(koboToNairaDecimal(c.expectedKobo)),
      fee: 53,
      payment_method: "bank_transfer",
      status: (opts.event ?? "charge.success") === "charge.success" ? "success" : "failed",
    }, opts);
  }

  transferWebhook(reference: string, status: "success" | "failed") {
    const p = this.payouts.get(reference);
    if (!p) throw new Error(`no payout ${reference}`);
    return this.webhook(`transfer.${status}`, {
      fee: 15,
      amount: Number(koboToNairaDecimal(p.amountKobo)),
      status,
      currency: "NGN",
      reference,
    });
  }

  /** Delivers a webhook to webhookTarget after a short delay, like Kora's async notifications. */
  private push(make: () => { rawBody: string; signature: string }, delayMs: number): void {
    const target = this.webhookTarget;
    if (!target) return;
    setTimeout(() => {
      const w = make();
      fetch(target, { method: "POST", headers: { "Content-Type": "application/json", "x-korapay-signature": w.signature }, body: w.rawBody }).catch((err: unknown) =>
        console.warn(`kora-double: webhook to ${target} failed: ${String(err)}`),
      );
    }, delayMs);
  }

  // ── HTTP ──

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://x");
    const path = url.pathname.replace(/^\/merchant\/api\/v1/, "");
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString("utf8");
    let body: Record<string, unknown> = {};
    if (text) body = JSON.parse(text) as Record<string, unknown>;
    const method = req.method ?? "GET";
    this.calls.push({ method, path: path + url.search, body });

    const send = (status: number, payload: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    };

    if (req.headers.authorization !== `Bearer ${this.secretKey}`) {
      return send(401, { status: false, error: "not_authenticated", message: "no authorization token found", data: null });
    }

    for (const [route, list] of this.overrides) {
      const [m, prefix] = route.split(" ") as [string, string];
      const o = list[0];
      if (o && m === method && path.startsWith(prefix)) {
        o.times = (o.times ?? 1) - 1;
        if (o.times <= 0) list.shift();
        if (o.delayMs) await new Promise((r) => setTimeout(r, o.delayMs));
        if (o.status !== undefined) return send(o.status, o.body ?? { status: false, message: "Internal server error", data: null });
      }
    }

    try {
      return this.route(method, path, url, body, send);
    } catch (e) {
      return send(500, { status: false, message: String(e), data: null });
    }
  }

  private route(method: string, path: string, url: URL, body: Record<string, unknown>, send: (s: number, p: unknown) => void): void {
    const str = (v: unknown) => (typeof v === "string" ? v : String(v ?? ""));

    if (method === "POST" && path === "/identities/ng/cac") {
      const rawId = str(body.id).replace(/^(RC|BN|IT|LP|LLP)/i, "");
      if (rawId === "00000011" || str(body.id) === "RC00000011") return send(200, cacValid.body);
      return send(404, { status: false, message: "No record found for this ID", data: null });
    }
    if (method === "GET" && path === "/identities/ng/banks") {
      if (url.searchParams.get("type") !== "basic") return send(200, { status: true, message: "Banks fetched successfully", data: [{ name: "Guaranty Trust Bank", code: "000013" }] });
      return send(200, banksBasic.body);
    }
    if (method === "POST" && path === "/identities/ng/bank-account-basic") {
      if (str(body.id) === "0123456789" && str(body.bank_code) === "058") return send(200, bankAccountBasic058.body);
      return send(404, { status: false, message: "Account not found", data: null });
    }

    if (method === "POST" && path === "/charges/bank-transfer") {
      const reference = str(body.reference);
      if (this.charges.has(reference)) return send(409, { status: false, code: "AA021", message: "duplicate payment reference", data: null });
      const expectedKobo = decimalToKobo(String(body.amount));
      const accountNumber = `90${randomInt(10_000_000, 99_999_999)}`;
      this.charges.set(reference, { reference, expectedKobo, paidKobo: 0n, acceptedKobo: 0n, status: "processing", accountNumber, paymentEvent: null });
      return send(200, {
        status: true,
        message: "Bank transfer initiated successfully",
        data: {
          currency: "NGN",
          amount: Number(koboToNairaDecimal(expectedKobo)),
          amount_expected: Number(koboToNairaDecimal(expectedKobo)),
          fee: 22.5,
          vat: 1.69,
          reference,
          payment_reference: reference,
          status: "processing",
          narration: str(body.narration),
          merchant_bears_cost: true,
          bank_account: {
            account_name: str(body.account_name),
            account_number: accountNumber,
            bank_name: "wema",
            bank_code: "035",
            expiry_date_in_utc: new Date(Date.now() + 30 * 60_000).toISOString(),
          },
          customer: body.customer,
        },
      });
    }
    if (method === "GET" && path.startsWith("/charges/")) {
      const c = this.charges.get(decodeURIComponent(path.slice("/charges/".length)));
      if (!c) return send(404, { status: false, message: "Charge not found", data: null });
      return send(200, {
        status: true,
        message: "Charge retrieved successfully",
        data: {
          reference: c.reference,
          status: c.status,
          amount: koboToNairaDecimal(c.expectedKobo),
          amount_paid: koboToNairaDecimal(c.paidKobo),
          ...(this.includeAccepted ? { amount_accepted: koboToNairaDecimal(c.acceptedKobo) } : {}),
          fee: "25.00",
          currency: "NGN",
          ...(c.paymentEvent ? { bank_transfer: { payment_event: c.paymentEvent, message: `${c.paymentEvent} occured, reversal not initiated`, reversal: null } } : {}),
        },
      });
    }
    if (method === "POST" && path === "/virtual-bank-account/sandbox/credit") {
      const c = [...this.charges.values()].find((x) => x.accountNumber === str(body.account_number));
      if (!c) return send(400, { status: false, message: "account not found", data: null });
      const after = this.pay(c.reference, decimalToKobo(String(body.amount)));
      if (after.status === "success") this.push(() => this.chargeWebhook(c.reference), 800);
      return send(200, { status: true, message: "Virtual bank account credited successfully", data: null });
    }

    if (method === "POST" && path === "/transactions/disburse") {
      const reference = str(body.reference);
      const dest = body.destination as { amount: number; bank_account: { bank: string; account: string } };
      const amountKobo = decimalToKobo(String(dest.amount));
      if (this.payouts.has(reference)) return send(409, { status: false, message: "duplicate reference", data: null });
      if (dest.bank_account.bank === "011") return send(400, { status: false, message: "Invalid account", data: null });
      if (amountKobo > this.availableKobo) return send(409, { status: false, message: "Insufficient funds in disbursement wallet", data: null });
      this.availableKobo -= amountKobo;
      const fails = dest.bank_account.bank === "035";
      this.payouts.set(reference, {
        reference,
        amountKobo,
        status: "processing",
        message: fails ? "Declined by receiving bank" : null,
        bank: dest.bank_account.bank,
        account: dest.bank_account.account,
      });
      this.push(() => {
        const p = this.payouts.get(reference);
        if (p && p.status === "processing") {
          p.status = fails ? "failed" : "success";
          if (fails) this.availableKobo += p.amountKobo;
        }
        return this.transferWebhook(reference, fails ? "failed" : "success");
      }, 1500);
      return send(200, {
        status: true,
        message: "transfer initiated successfully",
        data: { amount: koboToNairaDecimal(amountKobo), fee: "2.50", currency: "NGN", status: "processing", reference, narration: "x", customer: {} },
      });
    }
    if (method === "GET" && path.startsWith("/transactions/")) {
      const p = this.payouts.get(decodeURIComponent(path.slice("/transactions/".length)));
      if (!p) return send(404, { status: false, message: "Transaction not found", data: null });
      if (this.settlePayoutsOnQuery && p.status === "processing") {
        p.status = p.bank === "035" ? "failed" : "success";
        if (p.status === "failed") this.availableKobo += p.amountKobo;
      }
      return send(200, {
        status: true,
        message: "Transaction retrieved successfully",
        data: { reference: p.reference, status: p.status, amount: Number(koboToNairaDecimal(p.amountKobo)), fee: 10, currency: "NGN", message: p.message, trace_id: "000000000000000111111111111111" },
      });
    }

    if (method === "GET" && path === "/balances") {
      return send(200, { status: true, message: "success", data: { NGN: { pending_balance: 0, available_balance: Number(koboToNairaDecimal(this.availableKobo)) } } });
    }
    if (method === "GET" && path === "/balances/history") {
      return send(200, { status: true, message: "Balance history retrieved successfully", data: { has_more: false, history: [] } });
    }
    return send(404, { status: false, message: `double has no route ${method} ${path}`, data: null });
  }
}
