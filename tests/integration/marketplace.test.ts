import { describe, expect, it } from "vitest";
import { POST as requestPost } from "@/app/api/requests/route";
import { db } from "@/lib/db";
import { AI_REQUESTS_PER_DAY, aiRequestsLeft, useAiRequest } from "@/lib/domain/ai-allowance";
import { signUp } from "@/lib/domain/accounts";
import { createListing, publicListing, requestFromListing, searchListings, setListingStatus } from "@/lib/domain/listings";
import { registerVendor } from "@/lib/domain/vendor-profiles";

const PASSWORD = "a long and unusual passphrase";
let n = 0;

async function seller(name = "Owerri Prints", sells = "t-shirts printing") {
  n += 1;
  const contact = await registerVendor({
    businessName: name,
    phone: `0803555${String(1000 + n).slice(-4)}`,
    sells,
    city: "Owerri",
    rcNumber: "",
    ownerName: "Ngozi Okafor",
    bankCode: "058",
    accountNumber: "0123456789",
    email: `seller${n}@example.com`,
    consent: true,
  });
  const account = await signUp({ name, email: `seller-acct${n}@example.com`, password: PASSWORD });
  return db().account.update({ where: { id: account.id }, data: { vendorContactId: contact.id } });
}

async function buyer() {
  n += 1;
  return signUp({ name: "Tolu Adebayo", email: `buyer${n}@example.com`, password: PASSWORD });
}

const shirt = { title: "Branded round-neck T-shirt", description: "Cotton, all sizes", category: "Clothing and textiles" as const, priceKobo: 420_000n, unit: "piece", minOrder: 50 };

function tomorrowPlus(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

describe("marketplace listings", () => {
  it("a registered seller lists a product; anyone can find it; pausing hides it", async () => {
    const s = await seller();
    const listing = await createListing(s, shirt);
    expect((await searchListings({ q: "t-shirt" })).rows.map((r) => r.id)).toContain(listing.id);
    expect((await searchListings({ category: "Clothing and textiles", city: "owerri" })).total).toBe(1);
    expect((await searchListings({ q: "cement" })).total).toBe(0);

    await setListingStatus(s, listing.id, "PAUSED");
    expect(await publicListing(listing.id)).toBeNull();
    expect((await searchListings({ q: "t-shirt" })).total).toBe(0);
  });

  it("only a registered seller can list, and only their own products can be changed", async () => {
    const b = await buyer();
    await expect(createListing(b, shirt)).rejects.toMatchObject({ code: "not_vendor" });
    const s1 = await seller("Seller One");
    const s2 = await seller("Seller Two");
    const listing = await createListing(s1, shirt);
    await expect(setListingStatus(s2, listing.id, "REMOVED")).rejects.toMatchObject({ status: 404 });
  });

  it("refuses an oversized photo", async () => {
    const s = await seller();
    const big = Buffer.alloc(800 * 1024, 1).toString("base64");
    await expect(createListing(s, { ...shirt, photo: { type: "image/jpeg", base64: big } })).rejects.toMatchObject({ code: "photo_too_big" });
  });
});

describe("requesting from a listing", () => {
  it("opens a protected purchase that asks this seller first, and only them when the buyer says so", async () => {
    const s = await seller();
    const other = await seller("Other Shirts", "t-shirt branded");
    const listing = await createListing(s, shirt);
    const b = await buyer();

    const only = await requestFromListing(b, listing.id, { quantity: 100, budgetKobo: 42_000_000n, deadline: tomorrowPlus(7), alsoAskOthers: false });
    const vendorsOnly = await db().vendor.findMany({ where: { requestId: only.id }, orderBy: { label: "asc" } });
    expect(vendorsOnly.map((v) => v.contactId)).toEqual([s.vendorContactId]);
    expect(only).toMatchObject({ listingId: listing.id, isDemo: false, quantity: 100 });
    expect((await db().request.findUniqueOrThrow({ where: { id: only.id } })).status).toBe("COLLECTING");

    const compare = await requestFromListing(b, listing.id, { quantity: 100, budgetKobo: 42_000_000n, deadline: tomorrowPlus(7), alsoAskOthers: true });
    const vendorsCompare = await db().vendor.findMany({ where: { requestId: compare.id }, orderBy: { label: "asc" } });
    expect(vendorsCompare[0]?.contactId).toBe(s.vendorContactId);
    expect(vendorsCompare.map((v) => v.contactId)).toContain(other.vendorContactId);
  });

  it("checks the minimum order, the date, and that sellers can't request their own product", async () => {
    const s = await seller();
    const listing = await createListing(s, shirt);
    const b = await buyer();
    await expect(requestFromListing(b, listing.id, { quantity: 10, budgetKobo: 1_000_000n, deadline: tomorrowPlus(7), alsoAskOthers: false })).rejects.toMatchObject({ code: "below_minimum" });
    await expect(requestFromListing(b, listing.id, { quantity: 60, budgetKobo: 1_000_000n, deadline: tomorrowPlus(-2), alsoAskOthers: false })).rejects.toMatchObject({ code: "deadline_invalid" });
    await expect(requestFromListing(s, listing.id, { quantity: 60, budgetKobo: 1_000_000n, deadline: tomorrowPlus(7), alsoAskOthers: false })).rejects.toMatchObject({ code: "own_listing" });
  });
});

describe("daily AI allowance", () => {
  it("free accounts get 2 a day, Plus members 5", async () => {
    const free = await buyer();
    for (let i = 0; i < AI_REQUESTS_PER_DAY.free; i++) await useAiRequest(free);
    await expect(useAiRequest(free)).rejects.toMatchObject({ code: "ai_daily_limit" });
    expect(await aiRequestsLeft(free)).toEqual({ left: 0, limit: 2 });

    const plus = await db().account.update({ where: { id: (await buyer()).id }, data: { plusUntil: new Date(Date.now() + 30 * 86_400_000) } });
    for (let i = 0; i < AI_REQUESTS_PER_DAY.plus; i++) await useAiRequest(plus);
    await expect(useAiRequest(plus)).rejects.toMatchObject({ code: "ai_daily_limit" });
  });

  it("a request the AI couldn't understand doesn't use one up", async () => {
    const b = await buyer();
    const { accountSessionCookie } = await import("@/lib/http/session");
    const cookie = accountSessionCookie(b).split(";")[0] ?? "";
    const res = await requestPost(
      new Request("http://localhost:3000/api/requests", { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ text: "something nice please" }) }),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(422);
    expect(await aiRequestsLeft(b)).toEqual({ left: 2, limit: 2 });
  });
});
