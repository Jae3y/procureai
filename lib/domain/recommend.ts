import { type RankQuote, reviewAndRank } from "@/lib/ai/rank";
import { db } from "@/lib/db";
import type { Recommendation } from "@/lib/generated/prisma/client";
import { DomainError, NotFoundError } from "./errors";
import { specOf } from "./requests";
import { requestEvent } from "./timeline";

/** The latest verification for each vendor — what I1 also looks at. */
export async function latestVerifications(vendorIds: string[]) {
  const rows = await db().vendorVerification.findMany({ where: { vendorId: { in: vendorIds } }, orderBy: { seq: "desc" } });
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!latest.has(r.vendorId)) latest.set(r.vendorId, r);
  return latest;
}

export async function recommend(requestId: string): Promise<Recommendation> {
  const request = await db().request.findUnique({
    where: { id: requestId },
    include: { quotes: { include: { vendor: true } } },
  });
  if (!request) throw new NotFoundError("Request");
  if (request.status === "APPROVED") throw new DomainError("closed", "A vendor has already been approved.", 409);
  if (request.quotes.length === 0) throw new DomainError("no_quotes", "There are no quotes to compare yet.", 409);

  const latest = await latestVerifications(request.quotes.map((q) => q.vendorId));
  const quotes: RankQuote[] = request.quotes.map((q) => {
    const v = latest.get(q.vendorId);
    return {
      id: q.id,
      label: q.vendor.label,
      vendorName: q.vendor.name,
      registeredName: v?.registeredName ?? null,
      verdict: v ? v.verdict : "UNCHECKED",
      failureReason: v?.failureReason ?? null,
      matchMethod: v?.matchMethod ?? null,
      totalKobo: q.totalKobo,
      meetsSpec: q.meetsSpec,
      readyDate: q.readyDate ? q.readyDate.toISOString().slice(0, 10) : null,
    };
  });

  const r = await reviewAndRank(specOf(request), quotes);
  const rec = await db().recommendation.create({
    data: {
      requestId,
      chosenQuoteId: r.chosenQuoteId,
      rankedQuoteIds: r.rankedQuoteIds,
      reasoning: r.reasoning,
      model: r.model,
      parsedBy: r.parsedBy,
    },
  });
  await db().request.update({ where: { id: requestId }, data: { status: "RECOMMENDED" } });
  const chosen = quotes.find((q) => q.id === r.chosenQuoteId);
  await requestEvent(requestId, {
    kind: "info",
    title: chosen ? `Recommended ${chosen.label}` : "No vendor recommended",
    detail: r.parsedBy === "AI" ? `ranked by AI (${r.model ?? "model"})` : `ranked by rules${r.note ? ` — ${r.note}` : ""}`,
  });
  return rec;
}
