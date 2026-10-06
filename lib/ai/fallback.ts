import { decimalToKobo, type Kobo } from "@/lib/money";
import { type CivilDate, parseDayMonth, resolveReadyPhrase } from "./dates";
import { type Mention, moneyMentions } from "./numbers";

/**
 * Deterministic parsers — what ProcureAI does when there is no AI key, the model times out, or its
 * output fails validation. They must produce a usable result on their own (parsedBy = FALLBACK),
 * and they are held to the same golden tests as the AI path.
 */

// ── extractSpec ─────────────────────────────────────────────────────────────

export type Spec = { item: string; quantity: number; budgetKobo: Kobo; deadline: CivilDate };
export type SpecDraft = { item: string | null; quantity: number | null; budgetKobo: Kobo | null; deadline: CivilDate | null };

function scaled(digits: string, unit: string | undefined): Kobo | null {
  try {
    const base = decimalToKobo(digits);
    const u = (unit ?? "").toLowerCase();
    if (u === "m" || u === "million" || u === "mil") return base * 1_000_000n;
    if (u === "k" || u === "thousand") return base * 1_000n;
    return base;
  } catch {
    return null;
  }
}

export function extractSpecFallback(rawText: string, created: CivilDate): SpecDraft {
  const text = rawText.replace(/\s+/g, " ").trim();
  const qm = /^\s*([\d,]+)\s+(.+?)(?:,|\s+under\b|\s+below\b|\s+for\s+(?:₦|N|NGN)?\s?\d|\s+by\b|\s+within\b|\s+delivered\b|\s+budget\b|$)/i.exec(text);
  const bm = /(?:under|below|max(?:imum)?|budget(?:\s+of)?|not more than|within|less than)\s*(?:₦|N|NGN)?\s*([\d.,]+)\s*(m|k|million|thousand|mil)?\b/i.exec(text);
  const dm = /(?:by|before|latest|deliver(?:ed)?\s+(?:by|on)|on)\s+((?:\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?[A-Za-z]{3,9})|(?:[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?))/i.exec(text);

  const quantity = qm?.[1] ? Number.parseInt(qm[1].replace(/,/g, ""), 10) : null;
  const itemRaw = qm?.[2]?.trim() ?? null;
  const item = itemRaw ? itemRaw.charAt(0).toUpperCase() + itemRaw.slice(1) : null;
  const budgetKobo = bm?.[1] ? scaled(bm[1].replace(/,/g, ""), bm[2]) : null;
  const deadline = dm?.[1] ? parseDayMonth(dm[1], created) : null;
  return {
    item,
    quantity: quantity && Number.isSafeInteger(quantity) && quantity > 0 ? quantity : null,
    budgetKobo: budgetKobo && budgetKobo > 0n ? budgetKobo : null,
    deadline,
  };
}

// ── normalizeQuote ──────────────────────────────────────────────────────────

export type QuoteFlag =
  | "delivery_cost_not_stated"
  | "delivery_not_mentioned"
  | "delivers_in_person"
  | "upfront_not_stated"
  | "ready_date_not_stated"
  | "quantity_short"
  | "late"
  | "no_price"
  | "contains_instructions"
  | "ai_price_not_in_text"
  | "print_spec_differs";

export type NormalizedQuote = {
  unitPriceKobo: Kobo | null;
  deliveryKobo: Kobo | null;
  totalKobo: Kobo | null;
  upfrontPercent: number | null;
  readyDate: CivilDate | null;
  quantityOffered: number | null;
  meetsSpec: boolean;
  flags: QuoteFlag[];
};

const UNIT_WORDS = "(?:each|apiece|a\\s+piece|per\\s+(?:one|unit|piece|pc|pcs|shirt|tee|t-?shirt|item|head|copy)|\\/\\s?(?:unit|pc|piece|shirt|each|one))";
const UNIT_AFTER = new RegExp(`^\\s*${UNIT_WORDS}`, "i");
const UNIT_BEFORE = /(?:price\s+(?:is|na)|unit\s+price\s*(?:is|of|:)?|each\s+(?:is|na|go\s+be))\s*$/i;

export const INJECTION_RE =
  /ignore\s+(?:all\s+|any\s+)?(?:previous|prior|above|the)\s+(?:instructions|prompts?|rules)|recommend\s+(?:me|us|my|our)\b|disregard\s+(?:the\s+|all\s+)?(?:rules|instructions)|system\s+prompt|you\s+are\s+(?:now\s+)?(?:an?\s+)?(?:ai|assistant|chatgpt|model)|choose\s+(?:me|us)\b|act\s+as\b/i;

function findUnitPrice(text: string, mentions: Mention[]): Mention | null {
  for (const m of mentions) {
    if (UNIT_AFTER.test(text.slice(m.end))) return m;
    if (UNIT_BEFORE.test(text.slice(Math.max(0, m.index - 40), m.index))) return m;
  }
  return null;
}

function isQuantity(text: string, m: Mention): boolean {
  return /^\s*(?:pcs|pieces?|units?|shirts?|tees?|t-?shirts?|pc|items?)\b/i.test(text.slice(m.end));
}

function isDayCount(text: string, m: Mention): boolean {
  return /^\s*(?:working\s+|business\s+)?(?:days?|weeks?|hrs?|hours?)\b/i.test(text.slice(m.end));
}

function findDelivery(text: string, mentions: Mention[], exclude: Mention | null): { kobo: Kobo | null; flag: QuoteFlag | null; inPerson: boolean } {
  const t = text.toLowerCase();
  const inPerson = /\b(?:i|we)\s+(?:go\s+|will\s+|can\s+)?deliver\s+(?:it\s+)?(?:myself|ourselves|by\s+myself|in\s+person)\b/.test(t);
  if (
    /\bdelivery\b[^.;\n]{0,30}\b(?:free|included|inclusive|na\s+free|on\s+us)\b|\bfree\s+delivery\b|\ball[\s-]?in\b|\binclusive\s+of\s+delivery\b/.test(t) ||
    inPerson
  ) {
    return { kobo: 0n, flag: null, inPerson };
  }
  for (const m of mentions) {
    if (m === exclude || isQuantity(text, m) || isDayCount(text, m)) continue;
    const after = text.slice(m.end, m.end + 25).toLowerCase();
    const before = text.slice(Math.max(0, m.index - 25), m.index).toLowerCase();
    if (/^\s*(?:naira\s+)?(?:for|as|on)\s+(?:the\s+)?(?:delivery|transport|logistics|shipping)/.test(after) || /(?:delivery|transport|logistics|shipping)\s*(?:fee|cost|charge|is|na|:|go\s+be)?\s*(?:₦|n)?\s*$/.test(before)) {
      return { kobo: m.kobo, flag: null, inPerson: false };
    }
  }
  if (/\bdelivery\b[^.;\n]{0,20}\b(?:separate|extra|not\s+included|excluded|different|plus|on\s+you)\b|\bplus\s+delivery\b/.test(t)) {
    return { kobo: null, flag: "delivery_cost_not_stated", inPerson: false };
  }
  return { kobo: null, flag: "delivery_not_mentioned", inPerson: false };
}

function findUpfront(text: string): number | null {
  const t = text.toLowerCase();
  const pct =
    /(\d{1,3})\s?%\s*(?:upfront|up\s+front|deposit|advance|before|first|now|down|commitment|to\s+(?:start|commence))/.exec(t) ??
    /(?:upfront|deposit|advance|down\s*payment)\s*(?:of|is|:)?\s*(\d{1,3})\s?%/.exec(t);
  if (pct?.[1]) {
    const n = Number.parseInt(pct[1], 10);
    if (n >= 0 && n <= 100) return n;
  }
  if (/\b(?:pay\s+)?half\b[^.;\n]{0,25}\b(?:now|upfront|first|before|deposit|to\s+start)\b|\bhalf\s+(?:payment|down)\b|\b(?:pay|paying)\s+half\b/.test(t)) return 50;
  if (/\bfull\s+payment\b|\b100\s?%\b|\bpay\s+(?:everything|all)\s+(?:first|before|upfront)\b|\bpay\s+in\s+full\b/.test(t)) return 100;
  return null;
}

function findQuantity(text: string, mentions: Mention[]): number | null {
  for (const m of mentions) {
    if (isQuantity(text, m) && !m.hasCurrency && !m.scaled && /^[\d,]+$/.test(m.raw)) {
      // A count, not money: read the digits themselves rather than the money conversion.
      const n = Number.parseInt(m.raw.replace(/,/g, ""), 10);
      if (Number.isSafeInteger(n) && n > 0) return n;
    }
  }
  return null;
}

export function normalizeQuoteFallback(rawReply: string, spec: Spec, created: CivilDate): NormalizedQuote {
  const text = rawReply.replace(/\s+/g, " ").trim();
  const flags: QuoteFlag[] = [];
  const mentions = moneyMentions(text).filter((m) => !(m.kobo === 0n));

  if (INJECTION_RE.test(text)) flags.push("contains_instructions");

  const unit = findUnitPrice(text, mentions);
  const unitPriceKobo = unit?.kobo ?? null;
  if (!unitPriceKobo) flags.push("no_price");

  const delivery = findDelivery(text, mentions, unit);
  if (delivery.flag) flags.push(delivery.flag);
  if (delivery.inPerson) flags.push("delivers_in_person");

  const upfrontPercent = findUpfront(text);
  if (upfrontPercent === null) flags.push("upfront_not_stated");

  const quantityOffered = findQuantity(text, mentions);
  const readyDate = resolveReadyPhrase(text, created);
  if (!readyDate) flags.push("ready_date_not_stated");

  return finalizeQuote({ unitPriceKobo, deliveryKobo: delivery.kobo, upfrontPercent, readyDate, quantityOffered, flags }, spec);
}

/**
 * Shared by the AI and fallback paths: totals are computed HERE (unit × quantity + delivery) and
 * meetsSpec is decided by code, never by the model.
 */
export function finalizeQuote(
  q: { unitPriceKobo: Kobo | null; deliveryKobo: Kobo | null; upfrontPercent: number | null; readyDate: CivilDate | null; quantityOffered: number | null; flags: QuoteFlag[] },
  spec: Spec,
): NormalizedQuote {
  const flags = [...new Set(q.flags)];
  const shortQty = q.quantityOffered !== null && q.quantityOffered < spec.quantity;
  if (shortQty) flags.push("quantity_short");
  const late = q.readyDate !== null && q.readyDate > spec.deadline;
  if (late) flags.push("late");
  const totalKobo = q.unitPriceKobo !== null ? q.unitPriceKobo * BigInt(spec.quantity) + (q.deliveryKobo ?? 0n) : null;
  return {
    unitPriceKobo: q.unitPriceKobo,
    deliveryKobo: q.deliveryKobo,
    totalKobo,
    upfrontPercent: q.upfrontPercent,
    readyDate: q.readyDate,
    quantityOffered: q.quantityOffered,
    meetsSpec: q.unitPriceKobo !== null && !shortQty && !late,
    flags: [...new Set(flags)],
  };
}

/** Human labels for flags, rendered under the vendor name on the quotes screen. */
export const FLAG_COPY: Record<QuoteFlag, string> = {
  delivery_cost_not_stated: "Delivery cost not stated",
  delivery_not_mentioned: "Delivery not mentioned",
  delivers_in_person: "Delivers in person",
  upfront_not_stated: "Upfront not stated",
  ready_date_not_stated: "Ready date not stated",
  quantity_short: "Can't supply the full quantity",
  late: "Ready after your deadline",
  no_price: "No price given",
  contains_instructions: "Reply tried to instruct the AI; treated as data",
  ai_price_not_in_text: "AI reading rejected; parsed by rules",
  print_spec_differs: "Print spec differs",
};
