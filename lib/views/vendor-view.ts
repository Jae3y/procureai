import { db } from "@/lib/db";
import { vendorByToken } from "@/lib/domain/vendors";
import { kora } from "@/lib/kora/client";
import { isKoraError } from "@/lib/kora/errors";
import { log } from "@/lib/log";
import { formatNaira } from "@/lib/money";
import { civilDay, itemPhrase } from "./format";
import { buildOrderView, type OrderView } from "./order-view";

/** What the vendor sees on their phone at /v/<token>. Never includes the delivery code. */
export type VendorView = {
  screen: "quote" | "submitted" | "not-chosen" | "order";
  buyerName: string;
  itemLine: string;
  rows: Array<{ label: string; value: string }>;
  terms: string;
  quote: { raw: string; total: string; parsedBy: "AI" | "FALLBACK" } | null;
  banks: Array<{ name: string; code: string }>;
  banksError: string | null;
  /** Set when the picker shows Kora's payout bank list because its verification list came back empty. */
  banksNote: string | null;
  order: (Pick<OrderView, "ref" | "status" | "stage1Amount" | "stage2Amount" | "amount" | "vendor" | "events" | "lastEventId"> & { id: string; heldAmount: string; recordPath: string | null }) | null;
  closed: boolean;
};

export async function buildVendorView(token: string): Promise<VendorView> {
  const vendor = await vendorByToken(token);
  const request = await db().request.findUniqueOrThrow({
    where: { id: vendor.requestId },
    include: { buyer: true, order: true },
  });
  const quote = await db().quote.findUnique({ where: { vendorId: vendor.id } });

  let banks: Array<{ name: string; code: string }> = [];
  let banksError: string | null = null;
  let banksNote: string | null = null;
  if (!quote) {
    try {
      const list = await kora().bankPickerList();
      banks = list.banks.map((b) => ({ name: b.name, code: b.code })).sort((a, b) => a.name.localeCompare(b.name));
      if (list.source === "payout") banksNote = "Kora's verification bank list is empty here, so this is Kora's payout bank list.";
    } catch (err) {
      if (!isKoraError(err)) throw err;
      log.warn({ err: err.message }, "could not load Kora's bank list for the vendor form");
      banksError = err.userMessage;
    }
  }

  let order: VendorView["order"] = null;
  if (request.order && request.order.vendorId === vendor.id) {
    const v = await buildOrderView(request.order.id, "vendor");
    const heldLine = v.track.nodes[1]?.amount ?? v.amount;
    order = {
      id: v.id,
      ref: v.ref,
      status: v.status,
      amount: v.amount,
      stage1Amount: v.stage1Amount,
      stage2Amount: v.stage2Amount,
      vendor: v.vendor,
      events: v.events.filter((e) => e.name.startsWith("transfer.")),
      lastEventId: v.lastEventId,
      heldAmount: heldLine,
      recordPath: v.track.recordPath,
    };
  }

  const screen: VendorView["screen"] = order ? "order" : request.order ? "not-chosen" : quote ? "submitted" : "quote";
  return {
    screen,
    buyerName: request.buyer.name,
    itemLine: itemPhrase(request.quantity, request.item),
    rows: [
      { label: "Quantity", value: request.quantity.toLocaleString("en-NG") },
      { label: "Deliver by", value: civilDay(request.deadline) },
    ],
    terms: "If chosen, you're paid 30% when the buyer's money is held and 70% on delivery, straight to your business account.",
    quote: quote ? { raw: quote.rawReply, total: quote.totalKobo !== null ? formatNaira(quote.totalKobo) : "No price read", parsedBy: quote.parsedBy } : null,
    banks,
    banksError,
    banksNote,
    order,
    // Quotes are only taken while the request is collecting or being checked.
    closed: request.status === "CANCELLED" || (!quote && request.status !== "COLLECTING" && request.status !== "VERIFYING"),
  };
}
