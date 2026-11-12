-- ProcureAI Plus membership
ALTER TABLE "Account" ADD COLUMN "plusUntil" TIMESTAMP(3);

-- Marketplace listings
CREATE TYPE "ListingStatus" AS ENUM ('ACTIVE', 'PAUSED', 'REMOVED');

CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "priceKobo" BIGINT,
    "unit" TEXT NOT NULL,
    "minOrder" INTEGER NOT NULL DEFAULT 1,
    "photo" BYTEA,
    "photoType" TEXT,
    "status" "ListingStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Listing_status_category_idx" ON "Listing"("status", "category");
CREATE INDEX "Listing_contactId_idx" ON "Listing"("contactId");
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "VendorContact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Listings are short and small, like delivery proof: a photo of at most 700 KB, sane text and numbers.
ALTER TABLE "Listing" ADD CONSTRAINT "listing_photo_size" CHECK ("photo" IS NULL OR octet_length("photo") <= 716800);
ALTER TABLE "Listing" ADD CONSTRAINT "listing_photo_type" CHECK (("photo" IS NULL AND "photoType" IS NULL) OR "photoType" IN ('image/jpeg', 'image/png', 'image/webp'));
ALTER TABLE "Listing" ADD CONSTRAINT "listing_price_positive" CHECK ("priceKobo" IS NULL OR "priceKobo" > 0);
ALTER TABLE "Listing" ADD CONSTRAINT "listing_min_order" CHECK ("minOrder" BETWEEN 1 AND 1000000);
ALTER TABLE "Listing" ADD CONSTRAINT "listing_text" CHECK (length("title") BETWEEN 3 AND 100 AND length("description") <= 2000 AND length("unit") BETWEEN 1 AND 30);

-- A purchase can start from a listing
ALTER TABLE "Request" ADD COLUMN "listingId" TEXT;
ALTER TABLE "Request" ADD CONSTRAINT "Request_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Daily AI allowance
CREATE TABLE "AiDailyUse" (
    "accountId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "AiDailyUse_pkey" PRIMARY KEY ("accountId", "day")
);
ALTER TABLE "AiDailyUse" ADD CONSTRAINT "AiDailyUse_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
