-- AlterTable
ALTER TABLE "VendorContact" ADD COLUMN     "accountNumber" TEXT,
ADD COLUMN     "bankCode" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "rcNumber" TEXT,
ADD COLUMN     "registeredAt" TIMESTAMP(3);


-- A registered profile is complete: every detail Kora checks is present.
ALTER TABLE "VendorContact" ADD CONSTRAINT "registered_profile_complete" CHECK ("registeredAt" IS NULL OR ("rcNumber" IS NOT NULL AND "bankCode" IS NOT NULL AND "accountNumber" IS NOT NULL AND "email" IS NOT NULL));
