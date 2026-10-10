/**
 * npm run demo:reset [-- --short] — idempotently prepares a demo request in a few seconds:
 *   "300 branded T-shirts, under ₦1.5m" (₦1,260,000: two Kora transfers) or, with --short,
 *   "200 branded T-shirts, under ₦1m" (₦840,000: one transfer). The shortlisted vendors' replies are
 *   already in; Vendor A (cheapest) fails Kora's check and Vendor B is recommended.
 *
 * Nothing is deleted: earlier demo orders stay in the ledger so the reconciliation screen can still
 * match Kora's balance history. Unfinished earlier demo requests are cancelled; the new one becomes
 * "current" for /demo. Every run creates fresh Kora references, so re-runs never collide at Kora.
 */
import "dotenv/config";
import { db, disconnectDb } from "@/lib/db";
import { resetDemo } from "@/lib/demo/presenter";
import { env } from "@/lib/env";
import { inviteTokenFor } from "@/lib/crypto";
import { log } from "@/lib/log";
import { formatNaira } from "@/lib/money";

async function main() {
  const started = performance.now();
  if (!process.env.LOG_LEVEL || process.env.LOG_LEVEL === "info") log.level = "warn";
  const e = env();
  if (!e.DEMO_MODE) throw new Error("DEMO_MODE must be true to reset the demo");

  const scenario = process.argv.includes("--short") ? "short" : "full";
  const { requestId, cancelled } = await resetDemo(scenario);
  const request = await db().request.findUniqueOrThrow({ where: { id: requestId } });
  const cancelledCount = cancelled;
  const quotes = await db().quote.findMany({ where: { requestId: request.id }, include: { vendor: true }, orderBy: { vendor: { label: "asc" } } });
  const base = e.APP_BASE_URL.replace(/\/+$/, "");
  const ms = Math.round(performance.now() - started);
  console.log(`\nProcureAI demo reset in ${ms} ms  (cancelled ${cancelledCount} earlier demo request${cancelledCount === 1 ? "" : "s"})`);
  console.log(`Kora: ${e.koraMode} mode · identity ${e.SIMULATE_IDENTITY ? "SIMULATED" : "live sandbox"} · AI ${e.AI_API_KEY ? e.AI_MODEL : "off (rule-based parser)"}`);
  console.log(`\nRequest  "${request.rawText}"`);
  for (const q of quotes) console.log(`  ${q.vendor.label}  ${q.vendor.name}  total ${q.totalKobo === null ? "—" : formatNaira(q.totalKobo)}  parsed by ${q.parsedBy}`);
  console.log(`\nBuyer (laptop)   ${base}/demo`);
  console.log(`Admin            ${base}/admin`);
  console.log(`Vendor B (phone) ${base}/v/${inviteTokenFor(request.id, "Vendor B")}\n`);
  if (ms > 10_000) console.warn("⚠ reset took longer than 10s (AI provider latency?)");
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => disconnectDb());
