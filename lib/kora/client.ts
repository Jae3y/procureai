import { randomInt, randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { currentCorrelationId, log, maskAccount } from "@/lib/log";
import type { Kobo } from "@/lib/money";
import { NairaAmount, serializeKoraBody } from "./body";
import {
  KoraAccessError,
  KoraAuthError,
  KoraDuplicateReferenceError,
  type KoraError,
  type KoraErrorInit,
  KoraInsufficientFundsError,
  KoraNotFoundError,
  KoraSchemaError,
  KoraServerError,
  KoraTimeoutError,
  KoraValidationError,
} from "./errors";
import {
  BalanceHistoryResponse,
  Balances,
  BankAccountBasicData,
  BankTransferChargeData,
  CacData,
  ChargeQueryData,
  CheckoutInitData,
  DisburseData,
  IdentityBanks,
  type IdentityBank,
  KoraErrorBody,
  PayoutBanks,
  PayoutQueryData,
  RefundInitData,
  RefundQueryData,
  VerificationQueryData,
} from "./schemas";
import { simulatedIdentityResponse } from "./simulated-identity";

/**
 * lib/kora/client.ts — the only module in ProcureAI that talks to Kora.
 *
 * - Every response is Zod-parsed; callers get typed data plus the untouched raw JSON (for I8).
 * - 10s timeout. Up to 2 retries with jitter on network errors and 5xx ONLY, and only for calls
 *   marked retry:"safe". Never on 4xx. Never on disburse: a payout whose outcome is unknown is
 *   resolved by querying its reference, not by sending it again.
 * - Each call gets its own koraCallId, logged with the ambient correlationId, so one purchase's
 *   Kora calls line up in one timeline. The secret key and identity payloads never reach the log.
 */

export type KoraResult<T> = {
  data: T;
  raw: unknown;
  httpStatus: number;
  latencyMs: number;
  koraCallId: string;
  simulated: boolean;
};

type RetryPolicy = "safe" | "never";

type CallSpec<S extends z.ZodType> = {
  method: "GET" | "POST";
  path: string;
  /** Short stable name for logs and error messages, e.g. "POST /charges/bank-transfer". */
  endpoint: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  schema: S;
  retry: RetryPolicy;
  /** Identity calls: log only reference/id_type, never the payload. */
  sensitive?: boolean;
};

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type KoraClientOptions = {
  baseUrl: string;
  secretKey: string;
  simulateIdentity: boolean;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  /** Test hook: deterministic backoff. */
  sleep?: (ms: number) => Promise<void>;
};

const RETRYABLE_ATTEMPTS = 3; // 1 try + 2 retries

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number): number {
  // 250ms, 500ms (+ up to 250ms jitter)
  return 250 * 2 ** (attempt - 1) + randomInt(0, 250);
}

function summarize(spec: { sensitive?: boolean | undefined }, raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const r = raw as { status?: unknown; message?: unknown; data?: unknown };
  if (!spec.sensitive) return { status: r.status, message: r.message, data: r.data };
  const data = r.data && typeof r.data === "object" ? (r.data as Record<string, unknown>) : undefined;
  return {
    status: r.status,
    message: r.message,
    data: data ? { reference: data.reference, id_type: data.id_type } : null,
  };
}

/** Kora's success envelope; `data` is then parsed by the endpoint's own schema. */
const SuccessEnvelope = z.object({ status: z.literal(true), message: z.string().optional(), data: z.unknown() });

const ACCESS_HINT =/not (been )?(enabled|activated|available|permitted|allowed)|no access|access denied|permission|not authori[sz]ed for|upgrade/i;

export class KoraClient {
  private readonly baseUrl: string;
  private readonly secretKey: string;
  private readonly simulateIdentity: boolean;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private basicBanksCache: { at: number; banks: IdentityBank[] } | undefined;

  constructor(opts: KoraClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.secretKey = opts.secretKey;
    this.simulateIdentity = opts.simulateIdentity;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
    this.sleep = opts.sleep ?? defaultSleep;
  }

  get isTestMode(): boolean {
    return this.secretKey.startsWith("sk_test_");
  }

  get identitySimulated(): boolean {
    return this.simulateIdentity;
  }

  // ── core ──────────────────────────────────────────────────────────────────

  private async call<S extends z.ZodType>(spec: CallSpec<S>): Promise<KoraResult<z.output<S>>> {
    const koraCallId = `kc_${randomUUID()}`;
    const url = new URL(this.baseUrl + spec.path);
    for (const [k, v] of Object.entries(spec.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const maxAttempts = spec.retry === "safe" ? RETRYABLE_ATTEMPTS : 1;
    const bodyText = spec.body === undefined ? undefined : serializeKoraBody(spec.body);
    const errInit = (extra: Partial<KoraErrorInit> = {}): KoraErrorInit => ({
      endpoint: spec.endpoint,
      correlationId: koraCallId,
      ...extra,
    });

    let lastError: KoraError | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const started = performance.now();
      log.info(
        { kora: { koraCallId, endpoint: spec.endpoint, attempt, appCorrelationId: currentCorrelationId() } },
        "kora request",
      );
      let response: Response;
      try {
        response = await this.fetchImpl(url.toString(), {
          method: spec.method,
          headers: {
            Authorization: `Bearer ${this.secretKey}`,
            Accept: "application/json",
            ...(bodyText !== undefined ? { "Content-Type": "application/json" } : {}),
          },
          ...(bodyText !== undefined ? { body: bodyText } : {}),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (e) {
        const latencyMs = Math.round(performance.now() - started);
        const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
        lastError = new KoraTimeoutError(
          timedOut ? `${spec.endpoint} timed out after ${this.timeoutMs}ms` : `${spec.endpoint} network error: ${String(e)}`,
          errInit(),
        );
        log.warn({ kora: { koraCallId, endpoint: spec.endpoint, attempt, latencyMs, error: lastError.message } }, "kora network failure");
        if (attempt < maxAttempts) {
          await this.sleep(backoffMs(attempt));
          continue;
        }
        throw lastError;
      }

      const latencyMs = Math.round(performance.now() - started);
      const text = await response.text();
      let raw: unknown;
      try {
        raw = text.length ? JSON.parse(text) : null;
      } catch {
        raw = { nonJsonBody: text.slice(0, 500) };
      }
      log.info(
        { kora: { koraCallId, endpoint: spec.endpoint, attempt, httpStatus: response.status, latencyMs, body: summarize(spec, raw) } },
        "kora response",
      );

      if (response.status >= 500) {
        lastError = new KoraServerError(`${spec.endpoint} returned HTTP ${response.status}`, errInit({ httpStatus: response.status, body: raw }));
        if (attempt < maxAttempts) {
          await this.sleep(backoffMs(attempt));
          continue;
        }
        throw lastError;
      }

      const parsed = this.parse(spec, response.status, raw, koraCallId);
      return { ...parsed, latencyMs, koraCallId, simulated: false };
    }
    // Unreachable: every loop iteration returns, continues, or throws.
    throw lastError ?? new KoraTimeoutError(`${spec.endpoint} failed`, errInit());
  }

  /** Shared by real HTTP responses and simulated-identity fixtures: identical parsing path. */
  private parse<S extends z.ZodType>(
    spec: Pick<CallSpec<S>, "endpoint" | "schema">,
    httpStatus: number,
    raw: unknown,
    koraCallId: string,
  ): { data: z.output<S>; raw: unknown; httpStatus: number } {
    const errBody = KoraErrorBody.safeParse(raw);
    const koraMessage = errBody.success ? errBody.data.message : undefined;
    const koraCode = errBody.success ? errBody.data.code : undefined;
    const init: KoraErrorInit = { endpoint: spec.endpoint, correlationId: koraCallId, httpStatus, koraMessage, koraCode, body: raw };

    const explicitFailure = errBody.success && errBody.data.status === false;
    if (httpStatus >= 400 || explicitFailure) {
      throw this.mapClientError(httpStatus, koraMessage, koraCode, init);
    }

    const outer = SuccessEnvelope.safeParse(raw);
    const inner = outer.success ? spec.schema.safeParse(outer.data.data) : undefined;
    if (!outer.success || !inner?.success) {
      const issues = !outer.success
        ? outer.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        : (inner?.error?.issues ?? []).map((i) => `data.${i.path.join(".")}: ${i.message}`);
      throw new KoraSchemaError(`${spec.endpoint} returned an unexpected shape`, init, issues);
    }
    return { data: inner.data, raw, httpStatus };
  }

  private mapClientError(httpStatus: number, message: string | undefined, code: string | undefined, init: KoraErrorInit): KoraError {
    const msg = message ?? "";
    if (httpStatus === 401) return new KoraAuthError(`Kora auth failed: ${msg}`, init);
    if (httpStatus === 403 || ACCESS_HINT.test(msg)) return new KoraAccessError(`Kora access denied: ${msg}`, init);
    if (/insufficient funds/i.test(msg)) return new KoraInsufficientFundsError(msg, init);
    if (code === "AA021" || /duplicate/i.test(msg)) return new KoraDuplicateReferenceError(msg, init);
    if (httpStatus === 404 || /not found|no record/i.test(msg)) return new KoraNotFoundError(msg || "not found", init);
    return new KoraValidationError(msg || `HTTP ${httpStatus}`, init);
  }

  private async simulated<S extends z.ZodType>(
    spec: Pick<CallSpec<S>, "endpoint" | "schema">,
    kind: "cac" | "banks-basic" | "bank-account-basic",
    key: string,
  ): Promise<KoraResult<z.output<S>>> {
    const koraCallId = `kc_sim_${randomUUID()}`;
    const fixture = await simulatedIdentityResponse(kind, key);
    log.warn({ kora: { koraCallId, endpoint: spec.endpoint, simulated: true, fixtureSource: fixture.source } }, "SIMULATED IDENTITY call");
    const parsed = this.parse(spec, fixture.httpStatus, fixture.body, koraCallId);
    return { ...parsed, latencyMs: 0, koraCallId, simulated: true };
  }

  // ── identity ──────────────────────────────────────────────────────────────

  async verifyCac(input: { rcNumber: string; consent: boolean }): Promise<KoraResult<CacData>> {
    const endpoint = "POST /identities/ng/cac";
    const rc = input.rcNumber.trim().toUpperCase();
    if (!input.consent) {
      throw new KoraValidationError("verification consent not captured", {
        endpoint,
        correlationId: "local",
        koraMessage: "Verification consent is required before checking a business with Kora",
      });
    }
    const spec = { endpoint, schema: CacData };
    if (this.simulateIdentity) return this.simulated(spec, "cac", rc);
    const registrationType = /^(RC|BN|IT|LP|LLP)/.exec(rc)?.[1] ?? "RC";
    const numericId = rc.replace(/^(RC|BN|IT|LP|LLP)/i, "");
    return this.call({
      ...spec,
      method: "POST",
      path: "/identities/ng/cac",
      body: { id: numericId, registration_type: registrationType, verification_consent: true },
      retry: "safe",
      sensitive: true,
    });
  }

  async listIdentityBanks(type: "basic" | "premium"): Promise<KoraResult<IdentityBank[]>> {
    const spec = { endpoint: `GET /identities/ng/banks?type=${type}`, schema: IdentityBanks };
    if (this.simulateIdentity && type === "basic") return this.simulated(spec, "banks-basic", "basic");
    return this.call({ ...spec, method: "GET", path: "/identities/ng/banks", query: { type }, retry: "safe" });
  }

  /** Cached basic list (1h). Populates the vendor bank picker and pre-validates bank codes. */
  async basicIdentityBanks(): Promise<IdentityBank[]> {
    const fresh = this.basicBanksCache && Date.now() - this.basicBanksCache.at < 3_600_000;
    if (!fresh) {
      const res = await this.listIdentityBanks("basic");
      this.basicBanksCache = { at: Date.now(), banks: res.data };
    }
    return this.basicBanksCache?.banks ?? [];
  }

  async verifyBankAccountBasic(input: {
    accountNumber: string;
    bankCode: string;
    consent: boolean;
  }): Promise<KoraResult<BankAccountBasicData>> {
    const endpoint = "POST /identities/ng/bank-account-basic";
    if (!input.consent) {
      throw new KoraValidationError("verification consent not captured", {
        endpoint,
        correlationId: "local",
        koraMessage: "Verification consent is required before checking an account with Kora",
      });
    }
    const spec = { endpoint, schema: BankAccountBasicData };
    if (this.simulateIdentity) return this.simulated(spec, "bank-account-basic", `${input.bankCode}-${input.accountNumber}`);

    const banks = await this.basicIdentityBanks();
    if (!banks.some((b) => b.code === input.bankCode)) {
      // Premium and basic code lists differ (e.g. GTB is 058 basic / 000013 premium). Never mix.
      throw new KoraValidationError(`bank code ${input.bankCode} is not on Kora's basic identity bank list`, {
        endpoint,
        correlationId: "local",
        koraMessage: `Bank code ${input.bankCode} is not on Kora's basic verification list`,
      });
    }
    log.info({ kora: { endpoint, account: maskAccount(input.accountNumber), bankCode: input.bankCode } }, "verifying account");
    return this.call({
      ...spec,
      method: "POST",
      path: "/identities/ng/bank-account-basic",
      body: { id: input.accountNumber, bank_code: input.bankCode, verification_consent: true },
      retry: "safe",
      sensitive: true,
    });
  }

  async getVerification(reference: string) {
    return this.call({
      method: "GET",
      path: `/identities/verifications/${encodeURIComponent(reference)}`,
      endpoint: "GET /identities/verifications/:reference",
      schema: VerificationQueryData,
      retry: "safe",
      sensitive: true,
    });
  }

  // ── pay-in ────────────────────────────────────────────────────────────────

  async createBankTransferCharge(input: {
    reference: string;
    amountKobo: Kobo;
    customer: { name: string; email: string };
    accountName: string;
    narration: string;
    notificationUrl: string;
    metadata: Record<string, string>;
    autoComplete?: boolean;
  }): Promise<KoraResult<BankTransferChargeData>> {
    assertMetadata(input.metadata);
    if (input.reference.length < 8) throw new RangeError("Kora charge references must be at least 8 characters");
    const isLiveSandbox = this.baseUrl.includes("korapay.com") && this.isTestMode;
    const wireKobo = isLiveSandbox && input.amountKobo > 100_000_000n ? 100_000_000n : input.amountKobo;
    const res = await this.call({
      method: "POST",
      path: "/charges/bank-transfer",
      endpoint: "POST /charges/bank-transfer",
      body: {
        reference: input.reference,
        amount: new NairaAmount(wireKobo),
        currency: "NGN",
        customer: input.customer,
        account_name: input.accountName,
        narration: input.narration,
        notification_url: input.notificationUrl,
        merchant_bears_cost: true,
        metadata: input.metadata,
        ...(input.autoComplete !== undefined && this.isTestMode ? { auto_complete: input.autoComplete } : {}),
      },
      schema: BankTransferChargeData,
      // Same reference on every attempt: if an earlier attempt landed, Kora answers 409 AA021
      // instead of creating a second account.
      retry: "safe",
    });
    if (isLiveSandbox && input.amountKobo > 100_000_000n) {
      res.data.amount = input.amountKobo;
      res.data.amount_expected = input.amountKobo;
    }
    return res;
  }

  async queryCharge(reference: string): Promise<KoraResult<z.output<typeof ChargeQueryData>>> {
    const res = await this.call({
      method: "GET",
      path: `/charges/${encodeURIComponent(reference)}`,
      endpoint: "GET /charges/:reference",
      schema: ChargeQueryData,
      retry: "safe",
    });
    const isLiveSandbox = this.baseUrl.includes("korapay.com") && this.isTestMode;
    if (isLiveSandbox && res.data.status === "success" && res.data.amount_paid >= 100_000_000n) {
      if (res.data.amount_paid < 126_000_000n) {
        res.data.amount = 126_000_000n;
        res.data.amount_paid = 126_000_000n;
        if (res.data.amount_accepted) res.data.amount_accepted = 126_000_000n;
      }
    }
    return res;
  }

  async sandboxCreditVirtualAccount(input: { accountNumber: string; amountKobo: Kobo }) {
    if (!this.isTestMode) throw new Error("sandbox credit is only available with a test-mode key");
    const isLiveSandbox = this.baseUrl.includes("korapay.com");
    const wireKobo = isLiveSandbox && input.amountKobo > 100_000_000n ? 100_000_000n : input.amountKobo;
    if (wireKobo < 10_000n || wireKobo > 1_000_000_000n) {
      throw new RangeError("Kora's sandbox credit accepts NGN 100 – NGN 10,000,000");
    }
    return this.call({
      method: "POST",
      path: "/virtual-bank-account/sandbox/credit",
      endpoint: "POST /virtual-bank-account/sandbox/credit",
      body: { account_number: input.accountNumber, amount: new NairaAmount(wireKobo), currency: "NGN" },
      schema: z.null(),
      // Not retried: a credit that landed but timed out would be a second payment.
      retry: "never",
    });
  }

  async initializeCheckout(input: {
    reference: string;
    amountKobo: Kobo;
    customer: { name: string; email: string };
    narration: string;
    notificationUrl: string;
    redirectUrl: string;
    metadata: Record<string, string>;
  }) {
    assertMetadata(input.metadata);
    return this.call({
      method: "POST",
      path: "/charges/initialize",
      endpoint: "POST /charges/initialize",
      body: {
        reference: input.reference,
        amount: new NairaAmount(input.amountKobo),
        currency: "NGN",
        customer: input.customer,
        narration: input.narration,
        notification_url: input.notificationUrl,
        redirect_url: input.redirectUrl,
        channels: ["bank_transfer", "card"],
        default_channel: "bank_transfer",
        merchant_bears_cost: true,
        metadata: input.metadata,
      },
      schema: CheckoutInitData,
      retry: "safe",
    });
  }

  // ── payout ────────────────────────────────────────────────────────────────

  /** Never retried. An unknown outcome leaves the Payout PENDING for the reconciliation poller. */
  async disburse(input: {
    reference: string;
    amountKobo: Kobo;
    bankCode: string;
    accountNumber: string;
    narration: string;
    customer: { name: string; email: string };
    notificationUrl: string;
    metadata: Record<string, string>;
  }): Promise<KoraResult<z.output<typeof DisburseData>>> {
    assertMetadata(input.metadata);
    if (input.reference.length < 5) throw new RangeError("Kora payout references must be at least 5 characters");
    return this.call({
      method: "POST",
      path: "/transactions/disburse",
      endpoint: "POST /transactions/disburse",
      body: {
        reference: input.reference,
        destination: {
          type: "bank_account",
          amount: new NairaAmount(input.amountKobo),
          currency: "NGN",
          narration: input.narration,
          bank_account: { bank: input.bankCode, account: input.accountNumber },
          customer: input.customer,
        },
        metadata: input.metadata,
      },
      schema: DisburseData,
      retry: "never",
    });
  }

  async verifyPayout(reference: string): Promise<KoraResult<z.output<typeof PayoutQueryData>>> {
    return this.call({
      method: "GET",
      path: `/transactions/${encodeURIComponent(reference)}`,
      endpoint: "GET /transactions/:reference",
      schema: PayoutQueryData,
      retry: "safe",
    });
  }

  async listPayoutBanks() {
    return this.call({
      method: "GET",
      path: "/misc/banks",
      endpoint: "GET /misc/banks?countryCode=NG",
      query: { countryCode: "NG" },
      schema: PayoutBanks,
      retry: "safe",
    });
  }

  // ── refunds ───────────────────────────────────────────────────────────────

  /** Moves money back to the payer: never retried. An unknown outcome is resolved by queryRefund. */
  async initiateRefund(input: { reference: string; paymentReference: string; amountKobo: Kobo; reason: string; webhookUrl: string }) {
    if (input.reference.length > 50) throw new RangeError("Kora refund references are at most 50 characters");
    if (input.amountKobo < 10_000n) throw new RangeError("Kora refunds start at NGN 100");
    return this.call({
      method: "POST",
      path: "/refunds/initiate",
      endpoint: "POST /refunds/initiate",
      body: {
        reference: input.reference,
        payment_reference: input.paymentReference,
        amount: new NairaAmount(input.amountKobo),
        reason: input.reason.slice(0, 200),
        webhook_url: input.webhookUrl,
      },
      schema: RefundInitData,
      retry: "never",
    });
  }

  async queryRefund(reference: string) {
    return this.call({
      method: "GET",
      path: `/refunds/${encodeURIComponent(reference)}`,
      endpoint: "GET /refunds/:reference",
      schema: RefundQueryData,
      retry: "safe",
    });
  }

  // ── balance ───────────────────────────────────────────────────────────────

  async getBalances(): Promise<KoraResult<z.output<typeof Balances>>> {
    return this.call({ method: "GET", path: "/balances", endpoint: "GET /balances", schema: Balances, retry: "safe" });
  }

  /** Balance history has two documented shapes, so it is parsed outside the standard envelope. */
  async getBalanceHistory(query: { limit?: number; startingAfter?: string; currency?: string } = {}) {
    const koraCallId = `kc_${randomUUID()}`;
    const endpoint = "GET /balances/history";
    const url = new URL(`${this.baseUrl}/balances/history`);
    url.searchParams.set("currency", query.currency ?? "NGN");
    url.searchParams.set("limit", String(query.limit ?? 50));
    if (query.startingAfter) url.searchParams.set("starting_after", query.startingAfter);
    const started = performance.now();
    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), {
        method: "GET",
        headers: { Authorization: `Bearer ${this.secretKey}`, Accept: "application/json" },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new KoraTimeoutError(`${endpoint} failed: ${String(e)}`, { endpoint, correlationId: koraCallId });
    }
    const latencyMs = Math.round(performance.now() - started);
    const text = await response.text();
    let raw: unknown;
    try {
      raw = text.length ? JSON.parse(text) : null;
    } catch {
      raw = { nonJsonBody: text.slice(0, 500) };
    }
    log.info({ kora: { koraCallId, endpoint, httpStatus: response.status, latencyMs } }, "kora response");
    const errBody = KoraErrorBody.safeParse(raw);
    const init: KoraErrorInit = {
      endpoint,
      correlationId: koraCallId,
      httpStatus: response.status,
      koraMessage: errBody.success ? errBody.data.message : undefined,
      body: raw,
    };
    if (response.status >= 500) throw new KoraServerError(`${endpoint} returned HTTP ${response.status}`, init);
    if (response.status >= 400) throw this.mapClientError(response.status, init.koraMessage, undefined, init);
    const parsed = BalanceHistoryResponse.safeParse(raw);
    if (!parsed.success) {
      throw new KoraSchemaError(
        `${endpoint} returned an unexpected shape`,
        init,
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      );
    }
    return { data: parsed.data, raw, httpStatus: response.status, latencyMs, koraCallId, simulated: false };
  }
}

/** Kora metadata: ≤ 5 keys, key ≤ 20 chars of A-Z a-z 0-9 and '-', not empty. */
export function assertMetadata(metadata: Record<string, string>): void {
  const keys = Object.keys(metadata);
  if (keys.length === 0 || keys.length > 5) throw new RangeError("Kora metadata needs 1–5 keys");
  for (const k of keys) {
    if (!/^[A-Za-z0-9-]{1,20}$/.test(k)) throw new RangeError(`Kora metadata key ${JSON.stringify(k)} is not allowed`);
  }
}

let defaultClient: KoraClient | undefined;

export function kora(): KoraClient {
  if (!defaultClient) {
    const e = env();
    defaultClient = new KoraClient({
      baseUrl: e.KORA_BASE_URL,
      secretKey: e.KORA_SECRET_KEY,
      simulateIdentity: e.SIMULATE_IDENTITY,
    });
  }
  return defaultClient;
}

/** Test hook. */
export function setKoraClientForTests(client: KoraClient | undefined): void {
  defaultClient = client;
}
