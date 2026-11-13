import { db, transaction } from "@/lib/db";
import { notify, notifyOps } from "@/lib/notify/notifications";
import { DomainError, NotFoundError } from "./errors";

/**
 * Marketplace moderation. Anyone can report a listing; the owner reviews reports at /admin/listings and can take a
 * listing down. A taken-down listing disappears from the marketplace at once, the seller is told why, and only
 * ProcureAI can put it back. The terms promise exactly this ("We remove listings that are misleading, illegal,
 * counterfeit, or unsafe").
 */

export const REPORT_REASONS = ["misleading", "illegal", "counterfeit", "unsafe", "scam", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REASON_WORDS: Record<ReportReason, string> = {
  misleading: "Misleading (wrong price, photo or description)",
  illegal: "Illegal to sell",
  counterfeit: "Fake or counterfeit",
  unsafe: "Unsafe",
  scam: "Looks like a scam",
  other: "Something else",
};

/** After this many open reports a listing is paused automatically until the owner looks at it. */
export const AUTO_PAUSE_AFTER_REPORTS = 3;

export async function reportListing(listingId: string, input: { reason: ReportReason; note: string; accountId: string | null }): Promise<void> {
  const listing = await db().listing.findUnique({ where: { id: listingId }, include: { contact: { select: { businessName: true } } } });
  if (!listing || listing.status === "REMOVED") throw new NotFoundError("Listing");
  if (input.accountId) {
    const already = await db().listingReport.findFirst({ where: { listingId, accountId: input.accountId, resolvedAt: null } });
    if (already) return; // one open report per person per listing; reporting twice changes nothing
  }
  await transaction(async (tx) => {
    await tx.listingReport.create({ data: { listingId, reason: input.reason, note: input.note.trim().slice(0, 500), accountId: input.accountId } });
    const open = await tx.listingReport.count({ where: { listingId, resolvedAt: null } });
    if (open >= AUTO_PAUSE_AFTER_REPORTS && listing.status === "ACTIVE") {
      await tx.listing.update({ where: { id: listingId }, data: { status: "PAUSED", moderationNote: "Paused while ProcureAI reviews reports about it." } });
    }
    await notifyOps(tx, {
      kind: "ops.listing-report",
      title: `Listing reported: ${listing.title}`,
      body: `${REASON_WORDS[input.reason]} · ${listing.contact.businessName} · ${open} open report${open === 1 ? "" : "s"}${open >= AUTO_PAUSE_AFTER_REPORTS ? " · paused automatically" : ""}`,
      href: "/admin/listings",
    });
  });
}

/** The owner takes a listing down. The seller is told why and can't show it again. */
export async function takeDownListing(listingId: string, note: string): Promise<void> {
  const reason = note.trim();
  if (reason.length < 3) throw new DomainError("note_required", "Say briefly why, so the seller understands.", 400, { issues: [{ path: "note", message: "Say briefly why" }] });
  await transaction(async (tx) => {
    const listing = await tx.listing.findUnique({ where: { id: listingId }, include: { contact: { include: { account: { select: { id: true } } } } } });
    if (!listing) throw new NotFoundError("Listing");
    await tx.listing.update({ where: { id: listingId }, data: { status: "REMOVED", removedByAdminAt: new Date(), moderationNote: reason } });
    await tx.listingReport.updateMany({ where: { listingId, resolvedAt: null }, data: { resolvedAt: new Date(), resolution: "taken down" } });
    if (listing.contact.account) {
      await notify(tx, {
        accountId: listing.contact.account.id,
        kind: "listing.removed",
        title: "One of your products was taken down",
        body: `"${listing.title}" is no longer on the marketplace. Reason: ${reason} If you think this is a mistake, reply to any ProcureAI email.`,
        href: "/vendor",
      });
    }
  });
}

/** The owner decides a report was wrong: the listing shows again and its reports are closed. */
export async function restoreListing(listingId: string): Promise<void> {
  await transaction(async (tx) => {
    const listing = await tx.listing.findUnique({ where: { id: listingId } });
    if (!listing) throw new NotFoundError("Listing");
    await tx.listing.update({ where: { id: listingId }, data: { status: "ACTIVE", removedByAdminAt: null, moderationNote: null } });
    await tx.listingReport.updateMany({ where: { listingId, resolvedAt: null }, data: { resolvedAt: new Date(), resolution: "kept" } });
  });
}

export async function moderationQueue() {
  const [reported, recent] = await Promise.all([
    db().listing.findMany({
      where: { reports: { some: { resolvedAt: null } } },
      include: { contact: { select: { id: true, businessName: true, phone: true } }, reports: { where: { resolvedAt: null }, orderBy: { createdAt: "desc" } } },
      orderBy: { updatedAt: "desc" },
      take: 100,
    }),
    db().listing.findMany({
      where: { reports: { none: { resolvedAt: null } } },
      include: { contact: { select: { id: true, businessName: true, phone: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);
  return { reported, recent };
}
