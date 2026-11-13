import { describe, expect, it } from "vitest";
import { POST as adminPost } from "@/app/api/admin/listings/[id]/route";
import { db } from "@/lib/db";
import { resetEnvCache } from "@/lib/env";
import { signUp } from "@/lib/domain/accounts";
import { createListing, publicListing, setListingStatus } from "@/lib/domain/listings";
import { AUTO_PAUSE_AFTER_REPORTS, reportListing, restoreListing, takeDownListing } from "@/lib/domain/moderation";
import { registerVendor } from "@/lib/domain/vendor-profiles";

const PASSWORD = "a long and unusual passphrase";
let n = 0;

async function sellerWithListing() {
  n += 1;
  const contact = await registerVendor({
    businessName: `Mod Seller ${n}`,
    phone: `0805666${String(1000 + n).slice(-4)}`,
    sells: "t-shirts",
    city: "Lagos",
    ownerName: "Ngozi Okafor",
    bankCode: "058",
    accountNumber: "0123456789",
    email: `modseller${n}@example.com`,
    consent: true,
  });
  const a = await signUp({ name: "Ngozi Okafor", email: `modacct${n}@example.com`, password: PASSWORD });
  const seller = await db().account.update({ where: { id: a.id }, data: { vendorContactId: contact.id } });
  const listing = await createListing(seller, { title: "Round-neck T-shirt", description: "", category: "Clothing and textiles", priceKobo: 420_000n, unit: "piece", minOrder: 1 });
  return { seller, listing };
}

describe("marketplace moderation", () => {
  it("taking a listing down hides it, tells the seller why, and the seller can't put it back", async () => {
    const { seller, listing } = await sellerWithListing();
    await takeDownListing(listing.id, "The photo isn't of the product.");
    expect(await publicListing(listing.id)).toBeNull();
    const note = await db().notification.findFirst({ where: { accountId: seller.id, kind: "listing.removed" } });
    expect(note?.body).toContain("The photo isn't of the product.");
    await expect(setListingStatus(seller, listing.id, "ACTIVE")).rejects.toMatchObject({ status: 404 });
  });

  it("needs a reason the seller can read", async () => {
    const { listing } = await sellerWithListing();
    await expect(takeDownListing(listing.id, "")).rejects.toMatchObject({ code: "note_required" });
  });

  it("enough reports pause a listing until it's reviewed; the seller can't un-pause it; keeping it restores it", async () => {
    const { seller, listing } = await sellerWithListing();
    for (let i = 0; i < AUTO_PAUSE_AFTER_REPORTS; i++) await reportListing(listing.id, { reason: "misleading", note: `report ${i}`, accountId: null });
    expect((await db().listing.findUniqueOrThrow({ where: { id: listing.id } })).status).toBe("PAUSED");
    await expect(setListingStatus(seller, listing.id, "ACTIVE")).rejects.toMatchObject({ code: "under_review" });
    await restoreListing(listing.id);
    expect(await publicListing(listing.id)).not.toBeNull();
    expect(await db().listingReport.count({ where: { listingId: listing.id, resolvedAt: null } })).toBe(0);
  });

  it("one person reporting twice counts once", async () => {
    const { listing } = await sellerWithListing();
    const reporter = await signUp({ name: "Tolu Adebayo", email: `reporter${n}@example.com`, password: PASSWORD });
    await reportListing(listing.id, { reason: "scam", note: "", accountId: reporter.id });
    await reportListing(listing.id, { reason: "scam", note: "", accountId: reporter.id });
    expect(await db().listingReport.count({ where: { listingId: listing.id } })).toBe(1);
  });

  it("only the admin can take a listing down (with an admin password set, as in production)", async () => {
    Object.assign(process.env, { ADMIN_TOKEN: "an-admin-token-of-24-chars-min" });
    resetEnvCache();
    const { listing } = await sellerWithListing();
    const res = await adminPost(
      new Request(`http://localhost:3000/api/admin/listings/${listing.id}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" }, body: JSON.stringify({ action: "take-down", note: "spam" }) }),
      { params: Promise.resolve({ id: listing.id }) },
    );
    expect(res.status).toBe(403);
    expect(await publicListing(listing.id)).not.toBeNull();
    Object.assign(process.env, { ADMIN_TOKEN: "" });
    resetEnvCache();
  });
});
