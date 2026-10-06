import { z } from "zod";
import { jsonNumberToKobo } from "@/lib/money";
import { AiUnavailableError, chatJson } from "./client";
import type { CivilDate } from "./dates";
import { extractSpecFallback, type SpecDraft } from "./fallback";
import { textHasAmount } from "./numbers";
import { EXTRACT_SPEC_SYSTEM, extractSpecUser } from "./prompts";

/**
 * extractSpec(rawText) → { item, quantity, budgetKobo, deadline }.
 * The AI's answer is only used if every number it reports appears in the buyer's own sentence and
 * the deadline is a real date not before the request date; otherwise the rule parser's answer is.
 */

const AiSpec = z.object({
  item: z.string().min(1).max(120),
  quantity: z.number().int().positive().max(10_000_000).nullable(),
  budgetNaira: z.number().positive().nullable(),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});

export type SpecResult = { draft: SpecDraft; parsedBy: "AI" | "FALLBACK"; model: string | null; note: string | null };

export async function extractSpec(rawText: string, created: CivilDate): Promise<SpecResult> {
  const fallback = extractSpecFallback(rawText, created);
  try {
    const { data, model } = await chatJson({
      task: "extractSpec",
      system: EXTRACT_SPEC_SYSTEM,
      user: extractSpecUser(rawText, created),
      schema: AiSpec,
    });
    const budgetKobo = data.budgetNaira === null ? null : jsonNumberToKobo(data.budgetNaira);
    const numbersOk =
      (data.quantity === null || new RegExp(`\\b${data.quantity.toLocaleString("en-US").replace(/,/g, ",?")}\\b`).test(rawText)) &&
      (budgetKobo === null || textHasAmount(rawText, budgetKobo));
    const dateOk = data.deadline === null || (data.deadline >= created && !Number.isNaN(Date.parse(`${data.deadline}T00:00:00Z`)));
    if (!numbersOk || !dateOk) {
      return { draft: fallback, parsedBy: "FALLBACK", model: null, note: "AI reading did not match the sentence; parsed by rules" };
    }
    return {
      draft: {
        item: data.item.charAt(0).toUpperCase() + data.item.slice(1),
        quantity: data.quantity,
        budgetKobo,
        deadline: data.deadline,
      },
      parsedBy: "AI",
      model,
      note: null,
    };
  } catch (err) {
    if (!(err instanceof AiUnavailableError)) throw err;
    return { draft: fallback, parsedBy: "FALLBACK", model: null, note: err.message };
  }
}
