-- Every money movement records the provider that handled it, so it is always checked and refunded there.
ALTER TABLE "PayIn" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'kora';
ALTER TABLE "Payout" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'kora';
ALTER TABLE "Refund" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'kora';
ALTER TABLE "VendorVerification" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'kora';
