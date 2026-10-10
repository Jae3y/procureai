import { db } from "@/lib/db";
import { approve } from "@/lib/domain/approve";
import { revealHandoverCode, submitHandoverCode } from "@/lib/domain/handover";
import { reconcilePayout } from "@/lib/domain/payouts";
import { recommend } from "@/lib/domain/recommend";
import { createRequest, inviteVendors } from "@/lib/domain/requests";
import { setSetting } from "@/lib/domain/settings";
import { verifyVendors } from "@/lib/domain/verification";
import { kora } from "@/lib/kora/client";
import { log } from "@/lib/log";
import { formatNaira } from "@/lib/money";
import { deliverScriptedReplies, payAccount } from "./actions";
import { ensureDemoDirectory } from "./directory";
import { DEMO_BUYER, DEMO_SCENARIOS, DEMO_VENDORS, type DemoScenario } from "./script";

/** Presenter tools: everything a live pitch needs in one click, through the same code paths as a real purchase. */

const SYSTEM = { type: "SYSTEM" as const, id: "presenter" };

async function demoBuyer() {
  return (await db().buyer.findFirst({ where: { email: DEMO_BUYER.email }, orderBy: { createdAt: "asc" } })) ?? db().buyer.create({ data: { ...DEMO_BUYER } });
}

/** Fresh demo request with every scripted reply in. Earlier unfinished demo requests are cancelled; nothing is deleted. */
export async function resetDemo(scenario: DemoScenario): Promise<{ requestId: string; text: string; cancelled: number }> {
  await ensureDemoDirectory();
  const unused = await db().vendorContact.findMany({ where: { phone: { notIn: DEMO_VENDORS.map((v) => v.phone) }, vendors: { none: {} } } });
  if (unused.length) await db().vendorContact.deleteMany({ where: { id: { in: unused.map((u) => u.id) } } });
  const buyer = await demoBuyer();
  const cancelled = await db().request.updateMany({
    where: { buyerId: buyer.id, status: { in: ["DRAFT", "COLLECTING", "VERIFYING", "RECOMMENDED"] } },
    data: { status: "CANCELLED" },
  });
  await setSetting("payoutRoute", "SANDBOX_SUCCESS_033");
  await setSetting("suppressNextWebhook", "false");
  const text = DEMO_SCENARIOS[scenario];
  const request = await createRequest({ rawText: text, buyerId: buyer.id });
  await inviteVendors(request.id);
  await deliverScriptedReplies(request.id);
  await setSetting("currentDemoRequestId", request.id);
  return { requestId: request.id, text, cancelled: cancelled.count };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ask Kora about the order's pending payouts until `done` holds or time runs out. */
async function waitFor(orderId: string, done: (status: string) => boolean, timeoutMs: number): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const order = await db().order.findUniqueOrThrow({ where: { id: orderId }, include: { payouts: { where: { status: "PENDING" } } } });
    if (done(order.status)) return true;
    for (const p of order.payouts) await reconcilePayout(p.reference, SYSTEM);
    await sleep(5_000);
  }
  return false;
}

/**
 * Three orders a presenter can jump into: one waiting for payment, one with the money held and
 * Stage 1 out, one complete. Real Kora sandbox calls throughout; takes a couple of minutes.
 */
export async function prepareShowcase(): Promise<void> {
  const buyer = await demoBuyer();
  const stages = ["awaiting", "held", "complete"] as const;
  for (const stage of stages) {
    const request = await createRequest({ rawText: DEMO_SCENARIOS.short, buyerId: buyer.id });
    await inviteVendors(request.id);
    await deliverScriptedReplies(request.id);
    await verifyVendors(request.id);
    await recommend(request.id);
    const order = await approve(request.id, null, SYSTEM);
    if (stage === "awaiting") continue;
    await payAccount(order.id);
    if (!(await waitFor(order.id, (s) => s === "STAGE_1_PAID", 150_000)) || stage === "held") continue;
    // The vendor can only use the code once Kora confirms Stage 1 reached them.
    if (!(await waitForStage1(order.id))) continue;
    const code = revealHandoverCode(await db().order.findUniqueOrThrow({ where: { id: order.id } }));
    if (!code) continue;
    await submitHandoverCode(order.id, code, "presenter");
    await waitFor(order.id, (s) => s === "COMPLETE", 150_000);
  }
  log.info("presenter showcase orders ready");
}

async function waitForStage1(orderId: string): Promise<boolean> {
  const until = Date.now() + 150_000;
  while (Date.now() < until) {
    const s1 = await db().payout.findFirst({ where: { orderId, stage: "STAGE_1" }, orderBy: { createdAt: "desc" } });
    if (s1?.status === "SUCCESS") return true;
    if (s1?.status === "PENDING") await reconcilePayout(s1.reference, SYSTEM);
    await sleep(5_000);
  }
  return false;
}

/** One balance call to Kora, timed. */
export async function koraHealth(): Promise<string> {
  const started = performance.now();
  const b = await kora().getBalances();
  const ms = Math.round(performance.now() - started);
  const ngn = b.data.NGN;
  return `Kora answered in ${ms} ms · ${kora().isTestMode ? "sandbox" : "live"} · available ${ngn ? formatNaira(ngn.available_balance) : "n/a"}`;
}

/** The newest webhook that can be replayed or re-signed for a failure demo. */
export async function latestReplayableEvent(): Promise<string | null> {
  const ev = await db().koraEvent.findFirst({
    where: { source: "WEBHOOK", signatureValid: true, rawBody: { not: null }, signatureHeader: { not: null } },
    orderBy: { receivedAt: "desc" },
    select: { id: true },
  });
  return ev?.id ?? null;
}
