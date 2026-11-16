import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as listingPhoto } from "@/app/api/market/listings/[id]/photo/route";
import { db } from "@/lib/db";
import { signUp } from "@/lib/domain/accounts";
import { createListing, setListingStatus, updateListing } from "@/lib/domain/listings";
import { registerVendor } from "@/lib/domain/vendor-profiles";
import { resetEnvCache } from "@/lib/env";

/** Vercel Blob stands in as an in-memory store, so the test checks our side: what goes where, and what is cleaned up. */
const store = new Map<string, { bytes: Buffer; contentType: string; access: string }>();
vi.mock("@vercel/blob", () => ({
  put: vi.fn(async (name: string, body: Buffer, opts: { contentType: string; access: string }) => {
    const url = `https://store.private.blob.vercel-storage.com/${name}`;
    store.set(url, { bytes: Buffer.from(body), contentType: opts.contentType, access: opts.access });
    return { url, pathname: name };
  }),
  get: vi.fn(async (url: string) => {
    const f = store.get(url);
    return f ? { stream: new Blob([new Uint8Array(f.bytes)]).stream(), headers: new Headers(), blob: { contentType: f.contentType } } : null;
  }),
  del: vi.fn(async (url: string) => {
    store.delete(url);
  }),
}));

// The smallest valid PNG: enough for the type check.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const shirt = { title: "Branded round-neck T-shirt", description: "Cotton", category: "Clothing and textiles" as const, priceKobo: 420_000n, unit: "piece", minOrder: 50 };

async function seller() {
  const contact = await registerVendor({ businessName: "Owerri Prints", phone: "0803 555 7001", sells: "t-shirts", city: "Owerri", rcNumber: "", ownerName: "Ngozi Okafor", bankCode: "058", accountNumber: "0123456789", email: "seller-photo@example.com", consent: true });
  const account = await signUp({ name: "Owerri Prints", email: "seller-photo-acct@example.com", password: "a long and unusual passphrase" });
  return db().account.update({ where: { id: account.id }, data: { vendorContactId: contact.id } });
}

beforeEach(() => {
  store.clear();
  process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test_only";
  resetEnvCache();
});
afterEach(() => {
  process.env.BLOB_READ_WRITE_TOKEN = "";
  resetEnvCache();
});

describe("photos in file storage", () => {
  it("keeps a listing photo out of the database, as a private file, and still serves it", async () => {
    const s = await seller();
    const listing = await createListing(s, { ...shirt, photo: { type: "image/png", base64: PNG } });
    const row = await db().listing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(row.photo).toBeNull();
    expect(row.photoType).toBe("image/png");
    expect(row.photoUrl).toMatch(/^https:\/\/store\.private\.blob\.vercel-storage\.com\/listings\/[0-9a-f]{32}\.png$/);
    expect(store.get(row.photoUrl ?? "")?.access).toBe("private");

    const res = await listingPhoto(new Request(`http://localhost:3000/api/market/listings/${listing.id}/photo`), { params: Promise.resolve({ id: listing.id }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await res.arrayBuffer()).equals(Buffer.from(PNG, "base64"))).toBe(true);
  });

  it("deletes the old file when the photo is replaced, and the last one when the listing is removed", async () => {
    const s = await seller();
    const listing = await createListing(s, { ...shirt, photo: { type: "image/png", base64: PNG } });
    const first = (await db().listing.findUniqueOrThrow({ where: { id: listing.id } })).photoUrl;
    await updateListing(s, listing.id, { ...shirt, photo: { type: "image/png", base64: PNG } });
    const second = (await db().listing.findUniqueOrThrow({ where: { id: listing.id } })).photoUrl;
    expect(second).not.toBe(first);
    expect(store.has(first ?? "")).toBe(false);
    expect(store.has(second ?? "")).toBe(true);

    await setListingStatus(s, listing.id, "REMOVED");
    expect(store.size).toBe(0);
    expect((await db().listing.findUniqueOrThrow({ where: { id: listing.id } })).photoUrl).toBeNull();
  });

  it("without a storage key, photos stay in the database exactly as before", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "";
    resetEnvCache();
    const s = await seller();
    const listing = await createListing(s, { ...shirt, photo: { type: "image/png", base64: PNG } });
    const row = await db().listing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(row.photo).not.toBeNull();
    expect(row.photoUrl).toBeNull();
    expect(store.size).toBe(0);
  });
});
