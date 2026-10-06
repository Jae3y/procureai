import { z } from "zod";
import { jsonNumberToKobo, type Kobo } from "@/lib/money";
import { AiUnavailableError, chatJson } from "./client";
import { type CivilDate, resolveReadyPhrase } from "./dates";
import { finalizeQuote, INJECTION_RE, type NormalizedQuote, normalizeQuoteFallback, type QuoteFlag, type Spec } from "./fallback";
import { percentMentions, textHasAmount } from "./numbers";
import { NORMALIZE_SYSTEM, normalizeUser } from "./prompts";

/**
 * normalizeQuote(rawReply, spec) → a comparable row. The vendor's text is untrusted. The model only
 * *reads*; the server then fences what it read:
 *   • every naira amount and percentage must literally occur in the reply,
 *   • relative dates are re-resolved by code from the phrase the model quoted,
 *   • totals and meetsSpec are computed by code (finalizeQuote), never taken from the model,
 *   • the "contains instructions" flag is set by code, not by the model.
 * Anything that fails the fence → the rule-based parse (parsedBy FALLBACK).
 */

const AiQuote = z.object({
  unitPriceNaira: z.number().positive().nullable(),
  deliveryNaira: z.number().nonnegative().nullable(),
  deliveryIncluded: z.boolean(),
  upfrontPercent: z.number().int().min(0).max(100).nullable(),
  readyPhrase: z.string().max(200).nullable(),
  readyDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  quantityOffered: z.number().int().positive().nullable(),
});

export type QuoteResult = { quote: NormalizedQuote; parsedBy: "AI" | "FALLBACK"; model: string | null; note: string | null };

function toKobo(n: number | null): Kobo | null {
  return n === null ? null : jsonNumberToKobo(n);
}

export async function normalizeQuote(rawReply: string, spec: Spec, created: CivilDate): Promise<QuoteResult> {
  const fallback = normalizeQuoteFallback(rawReply, spec, created);
  try {
    const { data, model } = await chatJson({
      task: "normalizeQuote",
      system: NORMALIZE_SYSTEM,
      user: normalizeUser(rawReply, created, spec.quantity, spec.item),
      schema: AiQuote,
    });

    const unit = toKobo(data.unitPriceNaira);
    const deliveryStated = toKobo(data.deliveryNaira);
    const fenced =
      (unit === null || textHasAmount(rawReply, unit)) &&
      (deliveryStated === null || data.deliveryIncluded || textHasAmount(rawReply, deliveryStated)) &&
      (data.upfrontPercent === null || percentMentions(rawReply).includes(data.upfrontPercent)) &&
      (data.quantityOffered === null || new RegExp(`\\b${data.quantityOffered}\\b`).test(rawReply.replace(/,/g, ""))) &&
      (data.readyPhrase === null || rawReply.toLowerCase().includes(data.readyPhrase.toLowerCase().trim()));
    if (!fenced) {
      return {
        quote: { ...fallback, flags: [...new Set<QuoteFlag>([...fallback.flags, "ai_price_not_in_text"])] },
        parsedBy: "FALLBACK",
        model: null,
        note: "AI reported something the vendor did not write; parsed by rules",
      };
    }

    const readyDate =
      (data.readyPhrase ? resolveReadyPhrase(data.readyPhrase, created) : null) ??
      (data.readyDate && data.readyDate >= created ? data.readyDate : null);
    const deliveryKobo = data.deliveryIncluded ? 0n : deliveryStated;
    const flags: QuoteFlag[] = [];
    if (INJECTION_RE.test(rawReply)) flags.push("contains_instructions");
    if (unit === null) flags.push("no_price");
    if (deliveryKobo === null) flags.push(fallback.flags.includes("delivery_cost_not_stated") ? "delivery_cost_not_stated" : "delivery_not_mentioned");
    if (fallback.flags.includes("delivers_in_person")) flags.push("delivers_in_person");
    if (data.upfrontPercent === null) flags.push("upfront_not_stated");
    if (readyDate === null) flags.push("ready_date_not_stated");

    return {
      quote: finalizeQuote(
        { unitPriceKobo: unit, deliveryKobo, upfrontPercent: data.upfrontPercent, readyDate, quantityOffered: data.quantityOffered, flags },
        spec,
      ),
      parsedBy: "AI",
      model,
      note: null,
    };
  } catch (err) {
    if (!(err instanceof AiUnavailableError)) throw err;
    return { quote: fallback, parsedBy: "FALLBACK", model: null, note: err.message };
  }
}
