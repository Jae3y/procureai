import { inviteTokenFor } from "@/lib/crypto";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/domain/settings";
import { env } from "@/lib/env";
import { formatNaira } from "@/lib/money";
import { lagosDay, lagosTime, orderRef } from "./format";
import { moneySummary } from "./money-summary";

const STAGES: Array<{ stage: string; statuses: string[] }> = [
  { stage: "Waiting for payment", statuses: ["CREATED", "AWAITING_PAYMENT", "UNDERPAID"] },
  { stage: "Money held · Stage 1", statuses: ["HELD", "STAGE_1_PAID"] },
  { stage: "Code entered · Stage 2", statuses: ["CODE_VERIFIED", "RELEASED"] },
  { stage: "Complete", statuses: ["COMPLETE"] },
  { stage: "Payout failed", statuses: ["PAYOUT_FAILED"] },
];

/** The admin screen: orders, every Kora event (invalid signatures in red), outbox health, demo state. */
export type AdminView = {
  mode: { koraMode: "test" | "live"; simulateIdentity: boolean; aiEnabled: boolean; aiModel: string; demoMode: boolean; webhookUrl: string; checkoutRedirect: boolean };
  settings: { payoutRoute: string; suppressNextWebhook: boolean };
  orders: Array<{
    id: string;
    ref: string;
    item: string;
    vendor: string;
    amount: string;
    status: string;
    updated: string;
    trackerPath: string;
    requestId: string;
    isSample: boolean;
    /** Per-order reconciliation: everything Kora accepted is paid out, refunded or held. */
    money: { paidIn: string; paidOut: string; refunded: string; held: string; unaccounted: string; balanced: boolean };
  }>;
  /** For the presenter: the newest order at each point of the story. */
  stageLinks: Array<{ stage: string; ref: string; path: string } | { stage: string; ref: null; path: null }>;
  requests: Array<{ id: string; text: string; status: string; created: string; invites: Array<{ label: string; name: string; link: string; replied: boolean }> }>;
  events: Array<{ id: string; when: string; type: string; reference: string; source: string; signature: "valid" | "invalid" | "n/a"; method: string | null; processed: boolean; error: string | null; note: string | null; order: string | null; replayable: boolean }>;
  outbox: { pending: number; parked: number };
};

export async function buildAdminView(): Promise<AdminView> {
  const e = env();
  const base = e.APP_BASE_URL.replace(/\/+$/, "");
  const [orders, requests, events, pending, parked, payoutRoute, suppress, sampleOrderId] = await Promise.all([
    db().order.findMany({ orderBy: { updatedAt: "desc" }, take: 40, include: { request: true, vendor: true, payouts: true, refunds: true, ledger: true } }),
    db().request.findMany({ orderBy: { createdAt: "desc" }, take: 6, include: { vendors: { include: { quote: { select: { id: true } } }, orderBy: { label: "asc" } } } }),
    db().koraEvent.findMany({ orderBy: { receivedAt: "desc" }, take: 60, include: { order: { select: { number: true } } } }),
    db().outbox.count({ where: { doneAt: null } }),
    db().outbox.count({ where: { doneAt: { not: null }, lastError: { not: null } } }),
    getSetting("payoutRoute"),
    getSetting("suppressNextWebhook"),
    getSetting("sampleOrderId"),
  ]);
  return {
    mode: {
      koraMode: e.koraMode,
      simulateIdentity: e.SIMULATE_IDENTITY,
      aiEnabled: Boolean(e.AI_API_KEY),
      aiModel: e.AI_MODEL,
      demoMode: e.DEMO_MODE,
      webhookUrl: e.KORA_WEBHOOK_URL,
      checkoutRedirect: e.ENABLE_CHECKOUT_REDIRECT,
    },
    settings: { payoutRoute, suppressNextWebhook: suppress === "true" },
    orders: orders.map((o) => ({
      id: o.id,
      ref: orderRef(o.number),
      item: `${o.request.quantity} ${o.request.item}`,
      vendor: o.vendor.name ?? o.vendor.label,
      amount: formatNaira(o.amountKobo),
      status: o.status,
      updated: `${lagosDay(o.updatedAt)} ${lagosTime(o.updatedAt)}`,
      trackerPath: `/orders/${o.id}`,
      requestId: o.requestId,
      isSample: o.id === sampleOrderId,
      money: (() => {
        const m = moneySummary(o);
        return {
          paidIn: formatNaira(m.paidIn),
          paidOut: formatNaira(m.paidOut),
          refunded: formatNaira(m.refunded),
          held: formatNaira(m.held),
          unaccounted: formatNaira(m.unaccounted),
          balanced: m.unaccounted === 0n,
        };
      })(),
    })),
    stageLinks: STAGES.map(({ stage, statuses }) => {
      const o = orders.find((x) => statuses.includes(x.status));
      return o ? { stage, ref: orderRef(o.number), path: `/orders/${o.id}` } : { stage, ref: null, path: null };
    }),
    requests: requests.map((r) => ({
      id: r.id,
      text: r.rawText,
      status: r.status,
      created: `${lagosDay(r.createdAt)} ${lagosTime(r.createdAt)}`,
      invites: r.vendors.map((v) => ({ label: v.label, name: v.name ?? v.contactPhone, link: `${base}/v/${inviteTokenFor(r.id, v.label)}`, replied: Boolean(v.quote) })),
    })),
    events: events.map((ev) => ({
      id: ev.id,
      when: `${lagosDay(ev.receivedAt)} ${lagosTime(ev.receivedAt)}`,
      type: ev.type,
      reference: ev.reference,
      source: ev.source,
      signature: ev.signatureValid === null ? "n/a" : ev.signatureValid ? "valid" : "invalid",
      method: ev.signatureMethod,
      processed: Boolean(ev.processedAt),
      error: ev.processError,
      note: ev.demoNote,
      order: ev.order ? orderRef(ev.order.number) : null,
      replayable: ev.source === "WEBHOOK" && Boolean(ev.rawBody) && Boolean(ev.signatureHeader),
    })),
    outbox: { pending, parked },
  };
}
