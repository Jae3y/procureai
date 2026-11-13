import { lagosDate } from "@/lib/ai/dates";
import { db } from "@/lib/db";
import type { Account, Listing, ListingStatus, Request } from "@/lib/generated/prisma/client";
import type { Kobo } from "@/lib/money";
import { DomainError, NotFoundError } from "./errors";
import { decodePhoto } from "./evidence";
import { AUTO_PAUSE_AFTER_REPORTS } from "./moderation";
import { inviteVendors } from "./requests";
import { requestEvent } from "./timeline";

/**
 * The marketplace: what registered sellers offer, with photos and prices. Browsing is open to anyone.
 * Buying is never direct: "Request from this seller" opens an ordinary ProcureAI purchase, so the seller is
 * checked and the buyer's money is held exactly as for any other order.
 */

export const CATEGORIES = [
  "Printing and branding",
  "Clothing and textiles",
  "Food and drinks",
  "Building materials",
  "Electronics",
  "Office supplies",
  "Furniture",
  "Packaging",
  "Beauty and personal care",
  "Agriculture",
  "Services",
  "Other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export type ListingInput = {
  title: string;
  description: string;
  category: Category;
  priceKobo: Kobo | null;
  unit: string;
  minOrder: number;
  photo?: { type: string; base64: string } | null;
  /** On edit: true removes the current photo when no new one is sent. */
  removePhoto?: boolean;
};

async function sellerOf(account: Account) {
  if (!account.vendorContactId) throw new DomainError("not_vendor", "Register your business first, then you can add products.", 403);
  const contact = await db().vendorContact.findUnique({ where: { id: account.vendorContactId } });
  if (!contact?.registeredAt) throw new DomainError("not_vendor", "Register your business first, then you can add products.", 403);
  return contact;
}

/** At most this many live listings per seller for now; plenty for an SME, and it keeps the free tier fair. */
export const MAX_LISTINGS_PER_SELLER = 50;

export async function createListing(account: Account, input: ListingInput): Promise<Listing> {
  const contact = await sellerOf(account);
  const live = await db().listing.count({ where: { contactId: contact.id, status: { not: "REMOVED" } } });
  if (live >= MAX_LISTINGS_PER_SELLER) throw new DomainError("too_many_listings", `You can have up to ${MAX_LISTINGS_PER_SELLER} products listed. Remove one to add another.`, 409);
  const photo = decodePhoto(input.photo);
  return db().listing.create({
    data: {
      contactId: contact.id,
      title: input.title.trim(),
      description: input.description.trim(),
      category: input.category,
      priceKobo: input.priceKobo,
      unit: input.unit.trim(),
      minOrder: input.minOrder,
      photo: photo?.bytes ?? null,
      photoType: photo?.type ?? null,
    },
  });
}

async function ownListing(account: Account, listingId: string): Promise<Listing> {
  const contact = await sellerOf(account);
  const listing = await db().listing.findUnique({ where: { id: listingId } });
  if (!listing || listing.contactId !== contact.id || listing.status === "REMOVED") throw new NotFoundError("Listing");
  return listing;
}

export async function updateListing(account: Account, listingId: string, input: ListingInput): Promise<Listing> {
  await ownListing(account, listingId);
  const photo = decodePhoto(input.photo);
  return db().listing.update({
    where: { id: listingId },
    data: {
      title: input.title.trim(),
      description: input.description.trim(),
      category: input.category,
      priceKobo: input.priceKobo,
      unit: input.unit.trim(),
      minOrder: input.minOrder,
      ...(photo ? { photo: photo.bytes, photoType: photo.type } : input.removePhoto ? { photo: null, photoType: null } : {}),
    },
  });
}

export async function setListingStatus(account: Account, listingId: string, status: ListingStatus): Promise<void> {
  await ownListing(account, listingId);
  if (status === "ACTIVE") {
    // A listing paused because several people reported it stays paused until ProcureAI has looked at it.
    const open = await db().listingReport.count({ where: { listingId, resolvedAt: null } });
    if (open >= AUTO_PAUSE_AFTER_REPORTS) throw new DomainError("under_review", "This product is being reviewed after reports from buyers. We'll tell you as soon as we've looked at it.", 409);
  }
  // Removed listings stay in the database: purchases that started from them still point at them.
  await db().listing.update({ where: { id: listingId }, data: { status, ...(status === "REMOVED" ? { photo: null, photoType: null } : {}) } });
}

/** How a seller has been verified on past purchases. Nothing until their first check; every seller is checked before money moves. */
export type SellerStanding = "VERIFIED_BUSINESS" | "BANK_VERIFIED" | null;

export async function standingOf(contactIds: string[]): Promise<Map<string, SellerStanding>> {
  const out = new Map<string, SellerStanding>();
  if (contactIds.length === 0) return out;
  const rows = await db().vendorVerification.findMany({
    where: { verdict: "VERIFIED", vendor: { contactId: { in: contactIds } } },
    select: { matchMethod: true, vendor: { select: { contactId: true } } },
  });
  for (const r of rows) {
    const id = r.vendor.contactId;
    if (!id) continue;
    if (r.matchMethod === "COMPANY" || r.matchMethod === "DIRECTOR") out.set(id, "VERIFIED_BUSINESS");
    else if (r.matchMethod === "ACCOUNT_OWNER" && out.get(id) !== "VERIFIED_BUSINESS") out.set(id, "BANK_VERIFIED");
  }
  return out;
}

export type ListingSearch = { q?: string | undefined; category?: string | undefined; city?: string | undefined; page?: number | undefined };
export const PAGE_SIZE = 24;

/** Live listings from live sellers. Newest first; search matches title, description, category and the seller's name. */
export async function searchListings(s: ListingSearch) {
  const q = (s.q ?? "").trim().slice(0, 80);
  const words = q.split(/\s+/).filter((w) => w.length > 1).slice(0, 6);
  const category = CATEGORIES.find((c) => c === s.category);
  const city = (s.city ?? "").trim().slice(0, 60);
  const page = Math.max(1, Math.min(50, Math.floor(s.page ?? 1)));
  const where = {
    status: "ACTIVE" as const,
    contact: { registeredAt: { not: null }, isDemo: false, ...(city ? { city: { contains: city, mode: "insensitive" as const } } : {}) },
    ...(category ? { category } : {}),
    AND: words.map((w) => ({
      OR: [
        { title: { contains: w, mode: "insensitive" as const } },
        { description: { contains: w, mode: "insensitive" as const } },
        { category: { contains: w, mode: "insensitive" as const } },
        { contact: { businessName: { contains: w, mode: "insensitive" as const } } },
      ],
    })),
  };
  const [total, rows] = await Promise.all([
    db().listing.count({ where }),
    db().listing.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { id: true, title: true, priceKobo: true, unit: true, minOrder: true, category: true, photoType: true, updatedAt: true, contact: { select: { id: true, businessName: true, city: true } } },
    }),
  ]);
  return { total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), rows };
}

export async function publicListing(id: string) {
  const listing = await db().listing.findUnique({
    where: { id },
    select: {
      id: true, title: true, description: true, category: true, priceKobo: true, unit: true, minOrder: true, photoType: true, status: true, updatedAt: true,
      contact: { select: { id: true, businessName: true, city: true, category: true, registeredAt: true, isDemo: true, foundingNumber: true, createdAt: true } },
    },
  });
  if (!listing || listing.status !== "ACTIVE" || !listing.contact.registeredAt || listing.contact.isDemo) return null;
  return listing;
}

export async function publicSeller(contactId: string) {
  const contact = await db().vendorContact.findUnique({
    where: { id: contactId },
    select: {
      id: true, businessName: true, city: true, category: true, registeredAt: true, isDemo: true, foundingNumber: true,
      listings: { where: { status: "ACTIVE" }, orderBy: { updatedAt: "desc" }, take: 100, select: { id: true, title: true, priceKobo: true, unit: true, minOrder: true, category: true, photoType: true } },
    },
  });
  if (!contact?.registeredAt || contact.isDemo) return null;
  return contact;
}

export type ListingRequestInput = { quantity: number; budgetKobo: Kobo; deadline: string; alsoAskOthers: boolean };

/**
 * "Request from this seller": a structured purchase (no AI needed, so it never uses the buyer's AI allowance)
 * that invites this seller first and, if the buyer wants to compare, other sellers who match.
 */
export async function requestFromListing(account: Account, listingId: string, input: ListingRequestInput): Promise<Request> {
  const listing = await publicListing(listingId);
  if (!listing) throw new NotFoundError("Listing");
  if (account.vendorContactId === listing.contact.id) throw new DomainError("own_listing", "This is your own product.", 409);
  if (!Number.isInteger(input.quantity) || input.quantity < listing.minOrder) {
    throw new DomainError("below_minimum", `This seller's minimum order is ${listing.minOrder.toLocaleString("en-NG")} ${listing.unit}.`, 400, { issues: [{ path: "quantity", message: `At least ${listing.minOrder.toLocaleString("en-NG")}` }] });
  }
  if (input.budgetKobo <= 0n) throw new DomainError("budget_required", "Enter your budget.", 400, { issues: [{ path: "budget", message: "Enter your budget" }] });
  const today = lagosDate(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.deadline) || input.deadline <= today) {
    throw new DomainError("deadline_invalid", "Choose a date after today.", 400, { issues: [{ path: "deadline", message: "Choose a date after today" }] });
  }
  const request = await db().request.create({
    data: {
      buyerId: account.buyerId,
      isDemo: false,
      rawText: `${input.quantity.toLocaleString("en-NG")} × ${listing.title} (from ${listing.contact.businessName} on the marketplace)`,
      item: listing.title,
      quantity: input.quantity,
      budgetKobo: input.budgetKobo,
      deadline: new Date(`${input.deadline}T00:00:00Z`),
      specParsedBy: "FALLBACK",
      listingId: listing.id,
    },
  });
  await requestEvent(request.id, { kind: "info", title: "Started from the marketplace", detail: `${listing.title} · ${listing.contact.businessName}` });
  await inviteVendors(request.id, { pinnedContactId: listing.contact.id, onlyPinned: !input.alsoAskOthers });
  return request;
}
