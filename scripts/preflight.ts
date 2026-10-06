/**
 * npm run preflight — proves the Kora sandbox integration with the owner's test key.
 *
 * Calls, in order: CAC (valid + invalid), identity banks (basic), bank-account-basic, balance,
 * payouts to Kora's three documented test accounts (033 success, 035 failure, 011 invalid), a payout
 * to the identity test account (058/0123456789, to learn how the sandbox treats it), and a dynamic
 * bank-transfer charge plus its query. Prints PASS / FAIL / SKIPPED with latency and, for failures,
 * Kora's error body. Raw responses are recorded under lib/kora/fixtures/recorded (identity, used by
 * SIMULATE_IDENTITY) and tests/fixtures/kora/recorded (everything, used by tests).
 *
 * Safe to re-run: every reference is new, amounts are ₦100.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { KoraClient, type KoraResult } from "@/lib/kora/client";
import { isKoraError, KoraValidationError, type KoraError } from "@/lib/kora/errors";
import { log } from "@/lib/log";
import { formatNaira } from "@/lib/money";

type Row = { name: string; result: "PASS" | "FAIL" | "SKIPPED" | "INFO"; http: string; latencyMs: string; detail: string };

const rows: Row[] = [];
const runId = `${new Date().toISOString().slice(0, 10).replace(/-/g, "")}${randomBytes(3).toString("hex")}`;
const ref = (tag: string) => `PF-${runId}-${tag}`;

const IDENTITY_DIR = path.join(process.cwd(), "lib", "kora", "fixtures", "recorded");
const TEST_DIR = path.join(process.cwd(), "tests", "fixtures", "kora", "recorded");

async function record(dir: string, name: string, httpStatus: number, body: unknown) {
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, `${name}.json`),
    JSON.stringify({ httpStatus, recordedAt: new Date().toISOString(), source: "npm run preflight", body }, null, 2),
  );
}

function errDetail(e: KoraError): string {
  const body = e.body === undefined ? "" : ` body=${JSON.stringify(e.body).slice(0, 300)}`;
  return `${e.name}: ${e.message}${body}`;
}

async function step<T>(
  name: string,
  run: () => Promise<KoraResult<T>>,
  judge: (r: KoraResult<T>) => { ok: boolean; detail: string; info?: boolean },
  onError?: (e: KoraError) => { ok: boolean; detail: string } | undefined,
): Promise<KoraResult<T> | undefined> {
  const started = performance.now();
  try {
    const r = await run();
    const j = judge(r);
    rows.push({ name, result: j.info ? "INFO" : j.ok ? "PASS" : "FAIL", http: String(r.httpStatus), latencyMs: String(r.latencyMs), detail: j.detail });
    return r;
  } catch (e) {
    const latencyMs = String(Math.round(performance.now() - started));
    if (!isKoraError(e)) {
      rows.push({ name, result: "FAIL", http: "-", latencyMs, detail: `unexpected: ${String(e)}` });
      return undefined;
    }
    const verdict = onError?.(e);
    rows.push({
      name,
      result: verdict?.ok ? "PASS" : "FAIL",
      http: String(e.httpStatus ?? "-"),
      latencyMs,
      detail: verdict?.detail ?? errDetail(e),
    });
    // Only Kora's own JSON answers become fixtures — never a proxy or gateway page in front of it.
    const fromKora = typeof e.body === "object" && e.body !== null && !("nonJsonBody" in e.body);
    if (fromKora) await record(TEST_DIR, `error-${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`, e.httpStatus ?? 0, e.body);
    return undefined;
  }
}

/** Poll a payout until it leaves "processing" (sandbox settles within seconds) or 45s pass. */
async function settle(client: KoraClient, reference: string): Promise<{ status: string; message: string | null; latencyMs: number; raw: unknown } | undefined> {
  const started = performance.now();
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const q = await client.verifyPayout(reference);
      if (q.data.status !== "processing" && q.data.status !== "pending") {
        return { status: q.data.status, message: q.data.message ?? null, latencyMs: Math.round(performance.now() - started), raw: q.raw };
      }
    } catch (e) {
      if (!(isKoraError(e) && e.kind === "not_found")) throw e;
    }
  }
  return undefined;
}

async function payoutStep(client: KoraClient, label: string, bank: string, account: string, expect: "success" | "failed" | "rejected" | "observe") {
  const reference = ref(`PO${bank}`);
  const init = await step(
    `${label} (${bank}/${account})`,
    () =>
      client.disburse({
        reference,
        amountKobo: 100_000n,
        bankCode: bank,
        accountNumber: account,
        narration: "ProcureAI preflight",
        customer: { name: "ProcureAI Preflight", email: "preflight@procureai.com" },
        notificationUrl: process.env.KORA_WEBHOOK_URL || "https://example.com/preflight-no-webhook",
        metadata: { preflight: runId },
      }),
    (r) => ({ ok: true, detail: `initiated, status=${r.data.status}` }),
    (e) => {
      // Only Kora refusing the account counts; an auth, access, network or server failure proves nothing.
      if (expect === "rejected" && e instanceof KoraValidationError) return { ok: true, detail: `rejected at initiation as expected: ${e.koraMessage ?? e.message}` };
      return undefined;
    },
  );
  if (!init) return;
  await record(TEST_DIR, `disburse-${bank}`, init.httpStatus, init.raw);
  const final = await settle(client, reference);
  const row = rows[rows.length - 1];
  if (!row) return;
  if (!final) {
    row.result = expect === "observe" ? "INFO" : "FAIL";
    row.detail += "; still processing after 45s";
    return;
  }
  await record(TEST_DIR, `payout-query-${bank}-${final.status}`, 200, final.raw);
  row.detail += ` → ${final.status}${final.message ? ` ("${final.message}")` : ""} after ${final.latencyMs}ms`;
  if (expect === "observe") row.result = "INFO";
  else if (expect === "rejected") row.result = final.status === "success" ? "FAIL" : "PASS";
  else row.result = final.status === expect ? "PASS" : "FAIL";
}

function printTable() {
  const headers: Record<keyof Row, string> = { name: "Check", result: "Result", http: "HTTP", latencyMs: "ms", detail: "Detail" };
  const all = [headers, ...rows];
  const w = (k: keyof Row) => Math.min(Math.max(...all.map((r) => r[k].length)), k === "detail" ? 120 : 60);
  const line = (r: Record<keyof Row, string>) =>
    `| ${r.name.padEnd(w("name"))} | ${r.result.padEnd(w("result"))} | ${r.http.padEnd(w("http"))} | ${r.latencyMs.padStart(w("latencyMs"))} | ${r.detail.slice(0, 120).padEnd(w("detail"))} |`;
  const sep = `|${"-".repeat(w("name") + 2)}|${"-".repeat(w("result") + 2)}|${"-".repeat(w("http") + 2)}|${"-".repeat(w("latencyMs") + 2)}|${"-".repeat(w("detail") + 2)}|`;
  console.log(line(headers));
  console.log(sep);
  for (const r of rows) console.log(line(r));
}

async function main() {
  if (!process.env.LOG_LEVEL || process.env.LOG_LEVEL === "info") log.level = "warn";
  const baseUrl = process.env.KORA_BASE_URL || "https://api.korapay.com/merchant/api/v1";
  const secretKey = process.env.KORA_SECRET_KEY ?? "";
  console.log(`ProcureAI preflight · ${new Date().toISOString()} · run ${runId}`);
  console.log(`Base URL: ${baseUrl}`);

  // Reachability needs no key: an unauthenticated call must come back 401 from Kora itself.
  const reachStart = performance.now();
  try {
    const res = await fetch(`${baseUrl}/balances`, { signal: AbortSignal.timeout(10_000) });
    rows.push({
      name: "Kora reachable (no key → expect 401)",
      result: res.status === 401 ? "PASS" : "FAIL",
      http: String(res.status),
      latencyMs: String(Math.round(performance.now() - reachStart)),
      detail: (await res.text()).slice(0, 120),
    });
  } catch (e) {
    rows.push({ name: "Kora reachable", result: "FAIL", http: "-", latencyMs: "-", detail: String(e) });
  }

  if (!/^sk_test_/.test(secretKey)) {
    const why = secretKey ? "KORA_SECRET_KEY is not a test-mode key (sk_test_…)" : "KORA_SECRET_KEY is not set in .env";
    for (const name of [
      "CAC valid (RC00000011)",
      "CAC invalid (RC11111111)",
      "Identity banks (basic)",
      "Payout banks (/misc/banks, public key)",
      "Bank account basic (058/0123456789)",
      "Balance",
      "Payout success (033/0000000000)",
      "Payout failure (035/0000000000)",
      "Payout invalid account (011/9999999999)",
      "Payout to identity test account (058/0123456789)",
      "Bank-transfer charge",
      "Query charge",
    ]) {
      rows.push({ name, result: "SKIPPED", http: "-", latencyMs: "-", detail: why });
    }
    printTable();
    console.log(`\nIdentity status: UNKNOWN — ${why}.`);
    process.exitCode = 2;
    return;
  }

  const client = new KoraClient({ baseUrl, secretKey, publicKey: process.env.KORA_PUBLIC_KEY || undefined, simulateIdentity: false });

  const cac = await step(
    "CAC valid (RC00000011)",
    () => client.verifyCac({ rcNumber: "RC00000011", consent: true }),
    (r) => ({
      ok: r.data.company_status?.toUpperCase() === "ACTIVE",
      detail: `${r.data.name} · ${r.data.company_status ?? "?"} · ${r.data.key_personnel.length} key personnel · ${r.data.reference}`,
    }),
  );
  if (cac) await record(IDENTITY_DIR, "cac-RC00000011", cac.httpStatus, cac.raw);

  let invalidCacBody: { status: number; body: unknown } | undefined;
  await step(
    "CAC invalid (RC11111111)",
    () => client.verifyCac({ rcNumber: "RC11111111", consent: true }),
    (r) => ({ ok: false, detail: `expected a failure, got ${r.data.name} ${r.data.company_status ?? ""}` }),
    (e) => {
      if (e.kind === "access" || e.kind === "auth") return undefined;
      invalidCacBody = { status: e.httpStatus ?? 0, body: e.body };
      return { ok: true, detail: `rejected as expected: ${e.name} "${e.koraMessage ?? e.message}"` };
    },
  );
  if (invalidCacBody) await record(IDENTITY_DIR, "cac-RC11111111", invalidCacBody.status, invalidCacBody.body);

  const banks = await step(
    "Identity banks (basic)",
    () => client.listIdentityBanks("basic"),
    (r) => ({ ok: r.data.some((b) => b.code === "058"), detail: `${r.data.length} banks; 058 ${r.data.some((b) => b.code === "058") ? "present" : "MISSING"}` }),
  );
  if (banks) await record(IDENTITY_DIR, "banks-basic-basic", banks.httpStatus, banks.raw);

  // The vendor bank picker falls back to this list when the basic identity list is empty (sandbox).
  await step(
    "Payout banks (/misc/banks, public key)",
    () => client.listPayoutBanks(),
    (r) => ({ ok: r.data.some((b) => b.code === "058"), detail: `${r.data.length} banks; 058 ${r.data.some((b) => b.code === "058") ? "present" : "MISSING"}` }),
  );

  const acct = await step(
    "Bank account basic (058/0123456789)",
    () => client.verifyBankAccountBasic({ accountNumber: "0123456789", bankCode: "058", consent: true }),
    (r) => ({ ok: r.data.account_details.name.length > 0, detail: `${r.data.account_details.name} · ${r.data.reference}` }),
  );
  if (acct) await record(IDENTITY_DIR, "bank-account-basic-058-0123456789", acct.httpStatus, acct.raw);

  const bal = await step("Balance", () => client.getBalances(), (r) => {
    const ngn = r.data.NGN;
    return { ok: Boolean(ngn), detail: ngn ? `NGN available ${formatNaira(ngn.available_balance)} · pending ${formatNaira(ngn.pending_balance)}` : "no NGN balance" };
  });
  if (bal) await record(TEST_DIR, "balances", bal.httpStatus, bal.raw);

  await Promise.all([
    payoutStep(client, "Payout success", "033", "0000000000", "success"),
    payoutStep(client, "Payout failure", "035", "0000000000", "failed"),
    payoutStep(client, "Payout invalid account", "011", "9999999999", "rejected"),
    payoutStep(client, "Payout to identity test account", "058", "0123456789", "observe"),
  ]);

  const chargeRef = ref("PA");
  const charge = await step(
    "Bank-transfer charge",
    () =>
      client.createBankTransferCharge({
        reference: chargeRef,
        amountKobo: 10_000n,
        customer: { name: "ProcureAI Preflight", email: "preflight@procureai.com" },
        accountName: "ProcureAI preflight",
        narration: "ProcureAI preflight",
        notificationUrl: process.env.KORA_WEBHOOK_URL || "https://example.com/preflight-no-webhook",
        metadata: { preflight: runId },
        autoComplete: false,
      }),
    (r) => ({
      ok: r.data.bank_account.account_number.length >= 6,
      detail: `${r.data.bank_account.bank_name} ${r.data.bank_account.account_number} · expected ${formatNaira(r.data.amount_expected ?? r.data.amount)} · ${r.data.status}`,
    }),
  );
  if (charge) {
    await record(TEST_DIR, "charge-bank-transfer", charge.httpStatus, charge.raw);
    const q = await step(
      "Query charge",
      () => client.queryCharge(chargeRef),
      (r) => ({ ok: r.data.reference === chargeRef, detail: `status=${r.data.status} paid=${r.data.amount_paid !== null && r.data.amount_paid !== undefined ? formatNaira(r.data.amount_paid) : "n/a"}` }),
    );
    if (q) await record(TEST_DIR, "charge-query-processing", q.httpStatus, q.raw);
  } else {
    rows.push({ name: "Query charge", result: "SKIPPED", http: "-", latencyMs: "-", detail: "no charge was created" });
  }

  printTable();

  const identityRows = rows.filter((r) => /CAC|Identity banks|Bank account basic/.test(r.name));
  const blocked = identityRows.some((r) => /KoraAccessError|KoraAuthError/.test(r.detail));
  console.log(
    blocked
      ? "\nIdentity status: BLOCKED for this key. Set SIMULATE_IDENTITY=true (labelled in the UI) and see BLOCKERS.md B-03."
      : identityRows.every((r) => r.result === "PASS")
        ? "\nIdentity status: AVAILABLE (sandbox identity calls succeed with this key)."
        : "\nIdentity status: DEGRADED — see the failing identity rows above.",
  );
  if (rows.some((r) => r.result === "FAIL")) process.exitCode = 1;
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
