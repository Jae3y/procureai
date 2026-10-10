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
    expect(quotes.length).toBeGreaterThan(3);
    for (const q of quotes) expect(q.rawReply).not.toMatch(/shirt|print|apparel/i);
    for (const q of quotes.filter((x) => x.totalKobo !== null)) expect(q.totalKobo ?? 0n).toBeLessThanOrEqual(request.budgetKobo);
    const byName = (n: string) => quotes.find((q) => q.vendor.contactPhone === DEMO_VENDORS.find((v) => v.businessName === n)?.phone);
    expect(byName("Mama Tobi Trading")?.rawReply).toMatch(/40 cartons of noodles/i);
    // ₦600,000 / 40 = ₦15,000 a carton → 78% / 84% / 90%
    expect(byName("Mama Tobi Trading")?.totalKobo).toBe(40n * 11_700n * 100n);
    expect(byName("Kwik Supplies")?.totalKobo).toBe(40n * 12_600n * 100n);
    expect(byName("Imole Wholesale Ltd")?.totalKobo).toBe(40n * 13_500n * 100n);
  });

  it("T-shirts still reproduce the original ₦3,900 / ₦4,200 / ₦4,500", () => {
    const ask = { item: "Branded T-shirts", quantity: 300, budgetKobo: 150_000_000n };
    expect([78n, 84n, 90n].map((p) => demoUnitNaira(ask, p))).toEqual([3_900n, 4_200n, 4_500n]);
  });

  it("no scripted reply is hard-wired to one product", () => {
    const ask = { item: "Cartons of noodles", quantity: 40, budgetKobo: 60_000_000n };
    for (const v of DEMO_VENDORS) expect(v.reply(ask) ?? "").not.toMatch(/shirt|print|apparel/i);
  });
});

describe("sourcing from the wider market", () => {
  it("noodles: asks the vendors that sell food (up to 8), not just three", async () => {
    await db().vendorContact.deleteMany();
    const buyer = await makeBuyer();
    const request = await createRequest({ rawText: "40 cartons of noodles, under ₦600k, delivered by 12 October", buyerId: buyer.id });
    const invites = await inviteVendors(request.id);
    const names = invites.map((i) => i.businessName);
    expect(invites.length).toBeGreaterThan(3);
    expect(invites.length).toBeLessThanOrEqual(8);
    expect(names).toContain("Mile 12 Bulk Provisions");
    expect(names).not.toContain("Computer Village Direct"); // sells electronics, not noodles
    expect(names).toEqual(expect.arrayContaining(["Mama Tobi Trading", "Kwik Supplies", "Imole Wholesale Ltd"]));
    expect(names[0]).toBe("Mile 12 Bulk Provisions"); // matches "cartons" and "noodles": the best fit is asked first
  });

  it("some vendors decline or stay silent; the rest quote, and every quote is priced", async () => {
    await db().vendorContact.deleteMany();
    const { quotes } = await quotesFor("40 cartons of noodles, under ₦600k, delivered by 12 October");
    const invited = await db().vendor.count({ where: { requestId: quotes[0]?.requestId } });
    expect(quotes.length).toBeLessThan(invited); // someone never wrote back
    const priced = quotes.filter((q) => q.totalKobo !== null);
    expect(priced.length).toBeGreaterThanOrEqual(4);
  });

  it("a niche item still reaches the general merchants", async () => {
    await db().vendorContact.deleteMany();
    const buyer = await makeBuyer();
    const request = await createRequest({ rawText: "12 industrial gearboxes, under ₦3m, delivered by 30 October", buyerId: buyer.id });
    const invites = await inviteVendors(request.id);
    expect(invites.map((i) => i.businessName)).toEqual(["Mama Tobi Trading", "Kwik Supplies", "Imole Wholesale Ltd"]);
  });
});
