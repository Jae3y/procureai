import { z } from "zod";
import { formatNaira, koboToNairaDecimal, type Kobo } from "@/lib/money";
import { AiUnavailableError, chatJson } from "./client";
import type { CivilDate } from "./dates";
import type { Spec } from "./fallback";
import { RANK_SYSTEM } from "./prompts";

/**
 * reviewAndRank(spec, quotes, verifications) → { rankedQuoteIds, chosenQuoteId, reasoning }.
 *
 * The model sees structured facts only — labels, Kora-registered names, code-computed totals and
 * verification verdicts — never vendor free text, so a vendor cannot talk to the ranker.
 * After the model answers, the server enforces:
 *   • a quote that is not VERIFIED can never be chosen and always ranks below every verified one;
 *   • ids must be the ones we sent; the ranking is completed with anything the model dropped;
 *   • a choice over budget or past the deadline is rejected unless the reasoning names that trade-off.
 * Any violation → the deterministic ranking (parsedBy FALLBACK).
 */

export type RankQuote = {
  id: string;
  label: string; // "Vendor B"
  vendorName: string | null;
  registeredName: string | null;
  verdict: "VERIFIED" | "FAILED" | "UNCHECKED";
  failureReason: string | null;
  matchMethod: "COMPANY" | "DIRECTOR" | "NONE" | null;
  totalKobo: Kobo | null;
  meetsSpec: boolean;
  readyDate: CivilDate | null;
};

export type RankResult = {
  rankedQuoteIds: string[];
  chosenQuoteId: string | null;
  reasoning: string;
  parsedBy: "AI" | "FALLBACK";
  model: string | null;
  note: string | null;
};

const AiRank = z.object({
  rankedQuoteIds: z.array(z.string()).max(100),
  chosenQuoteId: z.string().nullable(),
  reasoning: z.string().min(10).max(800),
});

const withinBudget = (q: RankQuote, spec: Spec) => q.totalKobo !== null && q.totalKobo <= spec.budgetKobo;
const onTime = (q: RankQuote, spec: Spec) => q.readyDate === null || q.readyDate <= spec.deadline;
const eligible = (q: RankQuote) => q.verdict === "VERIFIED" && q.totalKobo !== null && q.meetsSpec;

function byTotal(a: RankQuote, b: RankQuote): number {
  if (a.totalKobo === null) return 1;
  if (b.totalKobo === null) return -1;
  if (a.totalKobo !== b.totalKobo) return a.totalKobo < b.totalKobo ? -1 : 1;
  return (a.readyDate ?? "9999") < (b.readyDate ?? "9999") ? -1 : 1;
}

function whyNot(q: RankQuote): string {
  const r = (q.failureReason ?? "").toLowerCase();
  if (q.verdict === "UNCHECKED") return "it hasn't been checked with Kora yet";
  if (r.includes("registration could not be verified") || r.includes("no business found")) return "Kora could not find its company registration";
  if (r.includes("not active")) return "its company registration is not active";
  if (r.includes("payout account")) return "its payout account doesn't belong to the business or its directors";
  return "Kora could not verify it";
}

export function rankFallback(spec: Spec, quotes: RankQuote[]): Omit<RankResult, "parsedBy" | "model" | "note"> {
  const sorted = [...quotes].sort(byTotal);
  const ok = sorted.filter(eligible);
  const ideal = ok.filter((q) => withinBudget(q, spec) && onTime(q, spec));
  const chosen = ideal[0] ?? ok[0] ?? null;

  const ranked = [
    ...ideal,
    ...ok.filter((q) => !ideal.includes(q)),
    ...sorted.filter((q) => q.verdict === "VERIFIED" && !eligible(q)),
    ...sorted.filter((q) => q.verdict !== "VERIFIED"),
  ].map((q) => q.id);

  if (!chosen) {
    return { rankedQuoteIds: ranked, chosenQuoteId: null, reasoning: "No vendor is both verified by Kora and able to meet this order, so ProcureAI won't recommend one yet." };
  }

  const sentences: string[] = [];
  const cheapest = sorted.find((q) => q.totalKobo !== null);
  if (cheapest && cheapest.id !== chosen.id && cheapest.verdict !== "VERIFIED") {
    sentences.push(`${cheapest.label} quoted the lowest price, but ${whyNot(cheapest)}, so ProcureAI will not send it money.`);
  }
  const owner = chosen.matchMethod === "COMPANY" ? "is in the company's own name" : "belongs to one of its directors";
  const runnerUp = ok.find((q) => q.id !== chosen.id);
  if (runnerUp && runnerUp.totalKobo !== null && chosen.totalKobo !== null && runnerUp.totalKobo > chosen.totalKobo) {
    sentences.push(
      `${chosen.label} is ${formatNaira(runnerUp.totalKobo - chosen.totalKobo)} cheaper than ${runnerUp.label}, is registered and active, and its payout account ${owner}.`,
    );
  } else {
    sentences.push(`${chosen.label} is registered and active, and its payout account ${owner}.`);
  }
  if (!withinBudget(chosen, spec) && chosen.totalKobo !== null) {
    sentences.push(`It is ${formatNaira(chosen.totalKobo - spec.budgetKobo)} over your budget; no verified vendor came in under it.`);
  }
  if (!onTime(chosen, spec)) sentences.push("It will be ready after your deadline; no verified vendor can deliver sooner.");
  return { rankedQuoteIds: ranked, chosenQuoteId: chosen.id, reasoning: sentences.join(" ") };
}

export async function reviewAndRank(spec: Spec, quotes: RankQuote[]): Promise<RankResult> {
  const fallback = rankFallback(spec, quotes);
  const ids = new Set(quotes.map((q) => q.id));
  try {
    const { data, model } = await chatJson({
      task: "reviewAndRank",
      system: RANK_SYSTEM,
      user: JSON.stringify({
        spec: { item: spec.item, quantity: spec.quantity, budgetNaira: koboToNairaDecimal(spec.budgetKobo), deadline: spec.deadline },
        quotes: quotes.map((q) => ({
          id: q.id,
          label: q.label,
          registeredName: q.registeredName,
          verification: q.verdict,
          verificationNote: q.verdict === "VERIFIED" ? null : whyNot(q),
          totalNaira: q.totalKobo === null ? null : koboToNairaDecimal(q.totalKobo),
          meetsSpec: q.meetsSpec,
          readyDate: q.readyDate,
        })),
      }),
      schema: AiRank,
    });

    const reject = (note: string): RankResult => ({ ...fallback, parsedBy: "FALLBACK", model: null, note });
    const byId = new Map(quotes.map((q) => [q.id, q]));
    const chosen = data.chosenQuoteId === null ? null : byId.get(data.chosenQuoteId);
    if (data.chosenQuoteId !== null && !chosen) return reject("AI chose a quote that doesn't exist");
    if (chosen && !eligible(chosen)) return reject("AI chose a vendor that isn't verified or can't meet the order");
    if (!chosen && fallback.chosenQuoteId) return reject("AI declined to choose although a verified vendor qualifies");
    if (chosen && !withinBudget(chosen, spec) && !/budget|over|more than|above/i.test(data.reasoning)) {
      return reject("AI chose a vendor over budget without saying so");
    }
    if (chosen && !onTime(chosen, spec) && !/deadline|late|after|delay/i.test(data.reasoning)) {
      return reject("AI chose a late vendor without saying so");
    }
    if (chosen && !data.reasoning.includes(chosen.label)) return reject("AI reasoning doesn't name its choice");

    // Complete and order the ranking: known ids only, nothing dropped, verified before unverified.
    const seen = new Set<string>();
    const aiOrder = data.rankedQuoteIds.filter((id) => ids.has(id) && !seen.has(id) && seen.add(id));
    const completed = [...aiOrder, ...fallback.rankedQuoteIds.filter((id) => !seen.has(id))];
    const verifiedFirst = [
      ...completed.filter((id) => byId.get(id)?.verdict === "VERIFIED"),
      ...completed.filter((id) => byId.get(id)?.verdict !== "VERIFIED"),
    ];
    if (chosen && verifiedFirst[0] !== chosen.id) {
      verifiedFirst.splice(verifiedFirst.indexOf(chosen.id), 1);
      verifiedFirst.unshift(chosen.id);
    }
    return { rankedQuoteIds: verifiedFirst, chosenQuoteId: chosen?.id ?? null, reasoning: data.reasoning.trim(), parsedBy: "AI", model, note: null };
  } catch (err) {
    if (!(err instanceof AiUnavailableError)) throw err;
    return { ...fallback, parsedBy: "FALLBACK", model: null, note: err.message };
  }
}
