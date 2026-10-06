/**
 * npm run demo:reset — idempotently prepares the §12 scenario in a few seconds:
 *   Request "300 branded T-shirts, under ₦1.5m, delivered by 23 October", three invited vendors
 *   with their messy replies already in (A ₦3,900 RC11111111 — will FAIL; B ₦4,200 RC00000011 —
 *   will verify via the director path and be recommended; C ₦4,500 — verified, not chosen).
 *
 * Nothing is deleted: earlier demo orders stay in the ledger so the reconciliation screen can still
 * match Kora's balance history. Unfinished earlier demo requests are cancelled; the new one becomes
 * "current" for /demo. Every run creates fresh Kora references, so re-runs never collide at Kora.
 */
import "dotenv/config";
import { db, disconnectDb } from "@/lib/db";
import { deliverScriptedReplies } from "@/lib/demo/actions";
import { DEMO_BUYER, DEMO_REQUEST_TEXT, DEMO_VENDORS } from "@/lib/demo/script";
import { createRequest, inviteVendors } from "@/lib/domain/requests";
import { setSetting } from "@/lib/domain/settings";
import { env } from "@/lib/env";
import { inviteTokenFor } from "@/lib/crypto";
import { log } from "@/lib/log";
import { formatNaira } from "@/lib/money";

async function main() {
  const started = performance.now();
  if (!process.env.LOG_LEVEL || process.env.LOG_LEVEL === "info") log.level = "warn";
  const e = env();
  if (!e.DEMO_MODE) throw new Error("DEMO_MODE must be true to reset the demo");

  // Directory: exactly the three demo vendors.
  for (const v of DEMO_VENDORS) {
    await db().vendorContact.upsert({
      where: { phone: v.phone },
      create: { businessName: v.businessName, phone: v.phone, category: v.category, city: v.city },
      update: { businessName: v.businessName, category: v.category, city: v.city },
    });
  }
  const unused = await db().vendorContact.findMany({ where: { phone: { notIn: DEMO_VENDORS.map((v) => v.phone) }, vendors: { none: {} } } });
  if (unused.length) await db().vendorContact.deleteMany({ where: { id: { in: unused.map((u) => u.id) } } });

  const buyer = (await db().buyer.findFirst({ where: { email: DEMO_BUYER.email } })) ?? (await db().buyer.create({ data: { ...DEMO_BUYER } }));
  const cancelled = await db().request.updateMany({
    where: { buyerId: buyer.id, status: { in: ["DRAFT", "COLLECTING", "VERIFYING", "RECOMMENDED"] } },
    data: { status: "CANCELLED" },
  });

  await setSetting("payoutRoute", "SANDBOX_SUCCESS_033");
  await setSetting("suppressNextWebhook", "false");

  const request = await createRequest({ rawText: DEMO_REQUEST_TEXT, buyerId: buyer.id });
  await inviteVendors(request.id);
  await deliverScriptedReplies(request.id);
  await setSetting("currentDemoRequestId", request.id);

  const quotes = await db().quote.findMany({ where: { requestId: request.id }, include: { vendor: true }, orderBy: { vendor: { label: "asc" } } });
  const base = e.APP_BASE_URL.replace(/\/+$/, "");
  const ms = Math.round(performance.now() - started);
  console.log(`\nProcureAI demo reset in ${ms} ms  (cancelled ${cancelled.count} earlier demo request${cancelled.count === 1 ? "" : "s"})`);
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
