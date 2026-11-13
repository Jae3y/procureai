-- Listing moderation: ProcureAI can take a listing down, and anyone can report one.
ALTER TABLE "Listing" ADD COLUMN "removedByAdminAt" TIMESTAMP(3);
ALTER TABLE "Listing" ADD COLUMN "moderationNote" TEXT;

CREATE TABLE "ListingReport" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "accountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,
    CONSTRAINT "ListingReport_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ListingReport_resolvedAt_createdAt_idx" ON "ListingReport"("resolvedAt", "createdAt");
CREATE INDEX "ListingReport_listingId_idx" ON "ListingReport"("listingId");
ALTER TABLE "ListingReport" ADD CONSTRAINT "ListingReport_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ListingReport" ADD CONSTRAINT "listing_report_reason" CHECK ("reason" IN ('misleading', 'illegal', 'counterfeit', 'unsafe', 'scam', 'other'));
ALTER TABLE "ListingReport" ADD CONSTRAINT "listing_report_note" CHECK (length("note") <= 500);
