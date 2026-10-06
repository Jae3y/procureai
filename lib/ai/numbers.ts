import { decimalToKobo, type Kobo } from "@/lib/money";

/**
 * Money and percentages as people actually write them in Nigerian vendor messages:
 * "4,200", "N4,500", "₦4.2k", "150k", "1.5m", "NGN 1,260,000", "60%", "half", "full payment".
 *
 * Used two ways: by the deterministic fallback parser, and to fence the AI — every amount or
 * percentage the model reports must be one that literally appears in the vendor's text.
 */

export type Mention = { kobo: Kobo; index: number; end: number; raw: string; hasCurrency: boolean; scaled: boolean };

const AMOUNT_RE =
  /(₦|\bN(?=\s?\d)|\bNGN\s?)?\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?!\d|[.,]\d)(\s?(?:k|m|million|mil|thousand)\b)?(?!\s?%)/gi;

export function moneyMentions(text: string): Mention[] {
  const out: Mention[] = [];
  for (const m of text.matchAll(AMOUNT_RE)) {
    const digits = m[2];
    if (!digits || m.index === undefined) continue;
    const suffix = (m[3] ?? "").trim().toLowerCase();
    let kobo: Kobo;
    try {
      kobo = decimalToKobo(digits);
    } catch {
      continue; // e.g. "4.2257" — not money anyone writes
    }
    if (suffix === "k" || suffix === "thousand") kobo *= 1_000n;
    else if (suffix === "m" || suffix === "million" || suffix === "mil") kobo *= 1_000_000n;
    out.push({ kobo, index: m.index, end: m.index + m[0].length, raw: m[0].trim(), hasCurrency: Boolean(m[1]), scaled: suffix !== "" });
  }
  return out;
}

export function textHasAmount(text: string, kobo: Kobo): boolean {
  return moneyMentions(text).some((m) => m.kobo === kobo);
}

export function percentMentions(text: string): number[] {
  const t = text.toLowerCase();
  const out = [...t.matchAll(/(\d{1,3})\s?%/g)].map((m) => Number.parseInt(m[1] ?? "", 10)).filter((n) => n >= 0 && n <= 100);
  if (/\bhalf\b/.test(t)) out.push(50);
  if (/\bfull(?:\s+payment)?\b|\beverything\b|\ball\s+(?:the\s+)?money\b/.test(t)) out.push(100);
  return out;
}

export function textHasPercent(text: string, pct: number): boolean {
  return percentMentions(text).includes(pct);
}
