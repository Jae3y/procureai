import { isSandboxTestCompany } from "@/lib/kora/limits";
import { moneySummary } from "./money-summary";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/domain/errors";
import { latestVerifications } from "@/lib/domain/recommend";
import { env } from "@/lib/env";
import { signRecordId } from "@/lib/crypto";
import { formatNaira } from "@/lib/money";
import { dayRange, itemPhrase, lagosDay, longOrderRef } from "./format";
import { splitSentences } from "./request-view";

/**
 * The shareable purchase record. Public behind a signed id. Every money line carries the Kora
 * reference it came from, and the closing stamp only claims what is true: "SIGNED BY KORA" when
 * every money movement was confirmed by a signature-verified webhook, "CONFIRMED WITH KORA" when
 * some were confirmed by querying Kora instead.
 */

export type RecordView = {
  ref: string;
  title: string;
  dates: string;
  buyer: string;
  request: string;
  quotes: Array<{ label: string; name: string; each: string; status: "Not verified" | "Chosen" | "Verified" | "Not checked"; struck: boolean }>;
  why: string[];
  checks: Array<{ text: string; ref: string; tone: "green" | "red" }>;
  money: Array<{ label: string; amount: string; ref: string; tone: "green" | "red" | "ink" }>;
  unaccounted: string;
  heldForRefund: string | null;
  complete: boolean;
  stamp: string | null;
  shareUrl: string;
  simulatedIdentity: boolean;
  sandboxRoute: string | null;
  statusLine: string;
};

export async function buildRecordView(orderId: string): Promise<RecordView> {
  const order = await db().order.findUnique({
    where: { id: orderId },
    include: {
      request: { include: { buyer: true, vendors: { include: { quote: true }, orderBy: { label: "asc" } }, recommendations: { orderBy: { createdAt: "desc" }, take: 1 } } },
      payIns: { orderBy: { sequence: "asc" } },
      payouts: { orderBy: { createdAt: "asc" } },
      refunds: true,
      ledger: true,
      events: true,
    },
  });
  if (!order) throw new NotFoundError("Record");
  const request = order.request;
  const latest = await latestVerifications(request.vendors.map((v) => v.id));
  const rec = request.recommendations[0];

  const quotes = request.vendors
    .filter((v) => v.quote)
    .sort((a, b) => {
      const x = a.quote?.totalKobo ?? 0n;
      const y = b.quote?.totalKobo ?? 0n;
      return x < y ? -1 : x > y ? 1 : 0;
    })
    .map((v) => {
      const ver = latest.get(v.id);
      const chosen = v.id === order.vendorId;
      const status = chosen ? "Chosen" : !ver ? "Not checked" : ver.verdict === "VERIFIED" ? "Verified" : "Not verified";
      return {
        label: v.label.replace("Vendor ", ""),
        name: v.name ?? v.label,
        each: v.quote?.unitPriceKobo != null ? formatNaira(v.quote.unitPriceKobo) : "—",
        status: status as RecordView["quotes"][number]["status"],
        struck: status === "Not verified",
      };
    });

  const checks: RecordView["checks"] = [];
  for (const v of request.vendors) {
    const ver = latest.get(v.id);
    if (!ver) continue;
    if (ver.verdict === "VERIFIED") {
      checks.push({ text: `${v.label.replace("Vendor ", "")} · ${ver.registeredName ?? v.name ?? v.label} · ${ver.rcNumber} · ${ver.companyStatus ? ver.companyStatus.charAt(0) + ver.companyStatus.slice(1).toLowerCase() : ""}${isSandboxTestCompany(ver.rcNumber) ? " · Kora sandbox test company" : ""}`, ref: ver.cacReference ?? "", tone: "green" });
      if (v.id === order.vendorId) {
        checks.push({
          text: ver.matchMethod === "COMPANY" ? "Payout account is in the company's name" : "Payout account owner is a director",
          ref: ver.accountReference ?? "",
          tone: "green",
        });
      }
    } else {
      checks.push({ text: `${v.label.replace("Vendor ", "")} · ${v.name ?? v.label} · ${ver.failureReason ?? "not verified"}`, ref: ver.cacReference ?? ver.rcNumber, tone: "red" });
    }
  }

  const money: RecordView["money"] = [];
  for (const p of order.payIns.filter((x) => x.status === "SUCCESS")) {
    money.push({ label: `Paid in · ${lagosDay(p.creditedAt ?? p.createdAt)}`, amount: formatNaira(p.amountAcceptedKobo), ref: p.reference, tone: "green" });
  }
  for (const p of order.payouts) {
    const stage = p.stage === "STAGE_1" ? "Stage 1" : "Stage 2";
    if (p.status === "SUCCESS") money.push({ label: `${stage} to vendor · ${lagosDay(p.resolvedAt ?? p.createdAt)}`, amount: formatNaira(p.amountKobo), ref: p.reference, tone: "green" });
    if (p.status === "FAILED") money.push({ label: `${stage} attempt failed, nothing sent`, amount: formatNaira(p.amountKobo), ref: p.reference, tone: "red" });
  }
  for (const r of order.refunds.filter((x) => x.status === "SUCCESS")) {
    money.push({ label: `Refunded to buyer · ${lagosDay(r.resolvedAt ?? r.createdAt)}`, amount: formatNaira(r.amountKobo), ref: r.reference, tone: "ink" });
  }

  const { held, unaccounted } = moneySummary(order);
  const excess = order.amountAcceptedKobo > order.amountKobo ? order.amountAcceptedKobo - order.amountKobo : 0n;
  if (held > 0n && order.status !== "COMPLETE") {
    money.push({ label: "Still held", amount: formatNaira(held), ref: "", tone: "ink" });
  }

  const complete = order.status === "COMPLETE";
  const moneyEvents = order.events.filter((ev) => ev.kind === "kora" && ["charge.success", "transfer.success", "refund.success"].includes(ev.title));
  const allSigned = moneyEvents.length > 0 && moneyEvents.every((ev) => ev.signature === "VERIFIED");
  const end = order.payouts.at(-1)?.resolvedAt ?? order.updatedAt;
  const routeNote = order.payouts.find((p) => p.route === "SANDBOX_TEST_ACCOUNT");

  return {
    ref: longOrderRef(order.number, order.createdAt),
    title: itemPhrase(request.quantity, request.item),
    dates: dayRange(request.createdAt, end),
    buyer: request.buyer.name,
    request: request.rawText,
    quotes,
    why: rec ? splitSentences(rec.reasoning) : [],
    checks,
    money,
    unaccounted: formatNaira(unaccounted),
    heldForRefund: excess > 0n ? formatNaira(excess) : null,
    complete,
    stamp: complete ? (allSigned ? "COMPLETE · ALL REFERENCES SIGNED BY KORA" : "COMPLETE · ALL REFERENCES CONFIRMED WITH KORA") : null,
    shareUrl: `${env().APP_BASE_URL.replace(/\/+$/, "")}/r/${signRecordId(order.id)}`,
    simulatedIdentity: (await db().vendorVerification.count({ where: { vendorId: { in: request.vendors.map((v) => v.id) }, simulated: true } })) > 0,
    sandboxRoute: routeNote ? `${routeNote.destinationBankCode}/${routeNote.destinationAccount}` : null,
    statusLine: complete ? "Complete" : order.status === "REFUNDED" ? "Refunded" : `In progress · ${order.status.toLowerCase().replace(/_/g, " ")}`,
  };
}
