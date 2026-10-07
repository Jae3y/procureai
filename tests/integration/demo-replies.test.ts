import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { deliverScriptedReplies } from "@/lib/demo/actions";
import { DEMO_VENDORS, demoUnitNaira } from "@/lib/demo/script";
import { createRequest, inviteVendors } from "@/lib/domain/requests";
import { makeBuyer } from "../helpers/factories";

/** The scripted vendors answer the buyer's own request. They once always talked about T-shirts. */
async function quotesFor(text: string) {
  const buyer = await makeBuyer();
  const request = await createRequest({ rawText: text, buyerId: buyer.id });
  await inviteVendors(request.id);
  await deliverScriptedReplies(request.id);
  const quotes = await db().quote.findMany({ where: { requestId: request.id }, include: { vendor: true }, orderBy: { vendor: { label: "asc" } } });
  return { request, quotes };
}

describe("scripted vendor replies follow the request", () => {
  it("noodles: replies mention the item and the prices scale to ₦600k / 40 cartons", async () => {
    await db().vendorContact.deleteMany();
    const { request, quotes } = await quotesFor("40 cartons of noodles, under ₦600k, delivered by 12 October");
    expect(quotes).toHaveLength(3);
    for (const q of quotes) {
      expect(q.rawReply).not.toMatch(/shirt|print|apparel/i);
      expect(q.totalKobo).not.toBeNull();
      expect(q.totalKobo ?? 0n).toBeLessThanOrEqual(request.budgetKobo);
    }
    const [a, b, c] = quotes;
    expect(a?.rawReply).toMatch(/40 cartons of noodles/i);
    // ₦600,000 / 40 = ₦15,000 a carton → 78% / 84% / 90%
    expect(a?.totalKobo).toBe(40n * 11_700n * 100n);
    expect(b?.totalKobo).toBe(40n * 12_600n * 100n);
    expect(c?.totalKobo).toBe(40n * 13_500n * 100n);
  });

  it("T-shirts still reproduce the original ₦3,900 / ₦4,200 / ₦4,500", () => {
    const ask = { item: "Branded T-shirts", quantity: 300, budgetKobo: 150_000_000n };
    expect([78n, 84n, 90n].map((p) => demoUnitNaira(ask, p))).toEqual([3_900n, 4_200n, 4_500n]);
  });

  it("no scripted reply is hard-wired to one product", () => {
    const ask = { item: "Cartons of noodles", quantity: 40, budgetKobo: 60_000_000n };
    for (const v of DEMO_VENDORS) expect(v.reply(ask)).not.toMatch(/shirt|print|apparel/i);
  });
});
