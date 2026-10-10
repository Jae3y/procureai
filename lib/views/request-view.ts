import { KORA_MAX_CHARGE_KOBO } from "@/lib/kora/limits";
import { FLAG_COPY, type QuoteFlag } from "@/lib/ai/fallback";
import { inviteTokenFor } from "@/lib/crypto";
import { shortlist } from "@/lib/domain/sourcing";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/domain/errors";
import { latestVerifications } from "@/lib/domain/recommend";
import { env } from "@/lib/env";
import type { RequestStatus } from "@/lib/generated/prisma/client";
import { formatNaira } from "@/lib/money";
import { civilDay, itemPhrase, lagosTime, orderRef } from "./format";

/**
 * Everything the request → quotes → recommendation screens render, computed server-side.
 * Amounts arrive formatted; the client does no money maths.
 */

export type KoraRow = { id: string; time: string; name: string; amount: string; detail: string; ref: string; signature: "VERIFIED" | "INVALID" | "API" | "SIMULATED" | null };

export type QuoteRow = {
  id: string;
  vendorId: string;
  label: string;
  phone: string;
  time: string;
  raw: string;
  name: string;
  note: string;
  each: string;
  total: string;
  upfront: string;
  ready: string;
  parsedBy: "AI" | "FALLBACK";
  meetsSpec: boolean;
};

export type CheckRow = {
  vendorId: string;
  quoteId: string | null;
  label: string;
  name: string;
  each: string;
  total: string;
  verdict: "VERIFIED" | "FAILED" | "UNCHECKED";
  registeredName: string | null;
  rcNumber: string | null;
  companyStatus: string | null;
  ownerLine: string | null;
  failureReason: string | null;
  cacReference: string | null;
  accountReference: string | null;
  simulated: boolean;
  chosen: boolean;
  differenceFromChosen: string | null;
};

export type RequestView = {
  id: string;
  status: RequestStatus;
  rawText: string;
  itemLine: string;
  spec: { item: string; quantity: string; budget: string; deadline: string };
  specParsedBy: "AI" | "FALLBACK";
  directoryCount: number;
  directoryTotal: number;
  invitedAt: string | null;
  invitedCount: number;
  repliedCount: number;
  quotes: QuoteRow[];
  checks: CheckRow[];
  /** Replies that arrived after the Kora check: not on the Decision list until they are checked too. */
  lateReplies: number;
  checkedAt: string | null;
  checkErrors: string[];
  recommendation: {
    chosenQuoteId: string | null;
    chosenLabel: string | null;
    chosenName: string | null;
    chosenTotal: string | null;
    reasoning: string[];
    parsedBy: "AI" | "FALLBACK";
    model: string | null;
    /** Kora's one-time accounts take up to ₦1,000,000 each; a larger total is paid in parts. */
    split: { transfers: number; parts: string[] } | null;
  } | null;
  events: KoraRow[];
  lastEventId: string;
  orderId: string | null;
  orderRef: string | null;
  invites: Array<{ label: string; phone: string; businessName: string; link: string }> | null;
  simulatedIdentity: boolean;
  /** Test key: verified identities are Kora's sandbox test company, labelled as such. */
  koraSandbox: boolean;
  aiEnabled: boolean;
};

function flagNote(flags: unknown): string {
  const list = Array.isArray(flags) ? (flags as QuoteFlag[]) : [];
  return list
    .filter((f) => f in FLAG_COPY)
    .map((f) => FLAG_COPY[f])
    .join(" · ");
}

function ownerLine(method: string | null, person: string | null): string | null {
  if (method === "COMPANY") return "Payout account is in the company's own name.";
  if (method === "DIRECTOR") return person?.includes("shareholder") ? "Payout account belongs to a registered shareholder." : "Payout account belongs to a registered director.";
  return null;
}

export function splitSentences(text: string): string[] {
  return text.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
}

export async function buildRequestView(requestId: string, opts: { includeInvites: boolean }): Promise<RequestView> {
  const request = await db().request.findUnique({
    where: { id: requestId },
    include: {
      vendors: { include: { quote: true, contact: true }, orderBy: { label: "asc" } },
      recommendations: { orderBy: { createdAt: "desc" }, take: 1 },
      order: true,
    },
  });
  if (!request) throw new NotFoundError("Request");
  const [directory, events, latest] = await Promise.all([
    db().vendorContact.findMany({ select: { id: true, category: true, createdAt: true } }),
    db().requestEvent.findMany({ where: { requestId }, orderBy: { id: "asc" } }),
    latestVerifications(request.vendors.map((v) => v.id)),
  ]);

  const rec = request.recommendations[0] ?? null;
  const quotes: QuoteRow[] = request.vendors
    .filter((v) => v.quote)
    .sort((a, b) => (a.quote?.receivedAt.getTime() ?? 0) - (b.quote?.receivedAt.getTime() ?? 0))
    .map((v) => {
      const q = v.quote!;
      return {
        id: q.id,
        vendorId: v.id,
        label: v.label,
        phone: v.contactPhone,
        time: lagosTime(q.receivedAt),
        raw: q.rawReply,
        name: v.name ?? v.contact?.businessName ?? v.label,
        note: flagNote(q.flags),
        each: q.unitPriceKobo !== null ? formatNaira(q.unitPriceKobo) : "—",
        total: q.totalKobo !== null ? formatNaira(q.totalKobo) : "—",
        upfront: q.upfrontPercent !== null ? `${q.upfrontPercent}%` : "—",
        ready: q.readyDate ? civilDay(q.readyDate) : "—",
        parsedBy: q.parsedBy,
        meetsSpec: q.meetsSpec,
      };
    });

  const chosenQuote = rec?.chosenQuoteId ? request.vendors.find((v) => v.quote?.id === rec.chosenQuoteId)?.quote ?? null : null;
  const checks: CheckRow[] = request.vendors
    .filter((v) => v.quote)
    .map((v) => {
      const q = v.quote!;
      const ver = latest.get(v.id);
      const chosen = rec?.chosenQuoteId === q.id;
      const diff =
        !chosen && chosenQuote?.totalKobo != null && q.totalKobo !== null && q.totalKobo > chosenQuote.totalKobo
          ? formatNaira(q.totalKobo - chosenQuote.totalKobo)
          : null;
      return {
        vendorId: v.id,
        quoteId: q.id,
        label: v.label,
        name: v.name ?? v.contact?.businessName ?? v.label,
        each: q.unitPriceKobo !== null ? formatNaira(q.unitPriceKobo) : "—",
        total: q.totalKobo !== null ? formatNaira(q.totalKobo) : "—",
        verdict: ver ? ver.verdict : ("UNCHECKED" as const),
        registeredName: ver?.registeredName ?? null,
        rcNumber: ver?.rcNumber ?? v.rcNumber,
        companyStatus: ver?.companyStatus ? ver.companyStatus.charAt(0) + ver.companyStatus.slice(1).toLowerCase() : null,
        ownerLine: ver?.verdict === "VERIFIED" ? ownerLine(ver.matchMethod, ver.matchedPerson) : null,
        failureReason: ver?.failureReason ?? null,
        cacReference: ver?.cacReference ?? null,
        accountReference: ver?.accountReference ?? null,
        simulated: ver?.simulated ?? false,
        chosen,
        differenceFromChosen: diff,
      };
    })
    .sort((a, b) => {
      const qa = request.vendors.find((v) => v.id === a.vendorId)?.quote?.totalKobo ?? null;
      const qb = request.vendors.find((v) => v.id === b.vendorId)?.quote?.totalKobo ?? null;
      if (qa === null) return 1;
      if (qb === null) return -1;
      return qa < qb ? -1 : qa > qb ? 1 : 0;
    });

  // Once a check has run, the Decision list is exactly what was checked and ranked; replies that
  // landed afterwards are counted separately instead of sitting there as "Checking…" forever.
  const settled = request.status !== "VERIFYING" && checks.some((c) => c.verdict !== "UNCHECKED");
  const shownChecks = settled ? checks.filter((c) => c.verdict !== "UNCHECKED") : checks;
  const lateReplies = settled ? checks.length - shownChecks.length : 0;
  const verifiedRows = [...latest.values()];
  const checkedAt = verifiedRows.length ? lagosTime(new Date(Math.max(...verifiedRows.map((v) => v.checkedAt.getTime())))) : null;
  const lastCheckError = events.filter((e) => e.kind === "error" && e.title.startsWith("Couldn't check"));
  const chosenVendor = chosenQuote ? request.vendors.find((v) => v.quote?.id === chosenQuote.id) : undefined;
  const invitedEvent = events.find((e) => e.title.startsWith("Asked "));
  const base = env().APP_BASE_URL.replace(/\/+$/, "");

  return {
    id: request.id,
    status: request.status,
    rawText: request.rawText,
    itemLine: itemPhrase(request.quantity, request.item),
    spec: {
      item: request.item,
      quantity: request.quantity.toLocaleString("en-NG"),
      budget: formatNaira(request.budgetKobo),
      deadline: civilDay(request.deadline),
    },
    specParsedBy: request.specParsedBy,
    directoryCount: shortlist(directory, request.item).length,
    directoryTotal: directory.length,
    invitedAt: invitedEvent ? lagosTime(invitedEvent.createdAt) : null,
    invitedCount: request.vendors.length,
    repliedCount: quotes.length,
    quotes,
    checks: shownChecks,
    lateReplies,
    checkedAt,
    checkErrors: lastCheckError.map((e) => `${e.title}: ${e.detail ?? ""}`),
    recommendation: rec
      ? {
          chosenQuoteId: rec.chosenQuoteId,
          chosenLabel: chosenVendor?.label ?? null,
          chosenName: chosenVendor ? (chosenVendor.name ?? chosenVendor.label) : null,
          chosenTotal: chosenQuote?.totalKobo != null ? formatNaira(chosenQuote.totalKobo) : null,
          reasoning: splitSentences(rec.reasoning),
          parsedBy: rec.parsedBy,
          model: rec.model,
          split: (() => {
            const total = chosenQuote?.totalKobo;
            if (total == null || total <= KORA_MAX_CHARGE_KOBO) return null;
            const parts: string[] = [];
            for (let left = total; left > 0n; left -= KORA_MAX_CHARGE_KOBO) parts.push(formatNaira(left > KORA_MAX_CHARGE_KOBO ? KORA_MAX_CHARGE_KOBO : left));
            return { transfers: parts.length, parts };
          })(),
        }
      : null,
    events: events
      .filter((e) => e.kind === "kora")
      .map((e) => ({ id: e.id.toString(), time: lagosTime(e.createdAt), name: e.title, amount: "", detail: e.detail ?? "", ref: e.koraReference ?? "", signature: (e.signature as KoraRow["signature"]) ?? null })),
    lastEventId: events.at(-1)?.id.toString() ?? "0",
    orderId: request.order?.id ?? null,
    orderRef: request.order ? orderRef(request.order.number) : null,
    // In DEMO_MODE the vendors are scripted, so the buyer may open their phones too.
    invites: opts.includeInvites || env().DEMO_MODE
      ? request.vendors.map((v) => ({
          label: v.label,
          phone: v.contactPhone,
          businessName: v.contact?.businessName ?? v.name ?? v.label,
          link: `${base}/v/${inviteTokenFor(request.id, v.label)}`,
        }))
      : null,
    simulatedIdentity: env().SIMULATE_IDENTITY,
    koraSandbox: env().koraMode === "test",
    aiEnabled: Boolean(env().AI_API_KEY),
  };
}
