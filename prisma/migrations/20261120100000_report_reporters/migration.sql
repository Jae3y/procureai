-- One open report per reporter per listing, and auto-pause counts different reporters. Additive only.
ALTER TABLE "ListingReport" ADD COLUMN "reporterKey" TEXT;
CREATE INDEX "ListingReport_listingId_reporterKey_idx" ON "ListingReport"("listingId", "reporterKey");
