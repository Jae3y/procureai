-- Two-step sign-in and a 24-hour hold on payout bank changes.
ALTER TABLE "Account" ADD COLUMN "totpSecretCipher" TEXT;
ALTER TABLE "Account" ADD COLUMN "totpPendingCipher" TEXT;
ALTER TABLE "Account" ADD COLUMN "totpEnabledAt" TIMESTAMP(3);
ALTER TABLE "Account" ADD COLUMN "totpLastStep" INTEGER;
ALTER TABLE "Account" ADD COLUMN "recoveryCodeHashes" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "VendorContact" ADD COLUMN "pendingBankCode" TEXT;
ALTER TABLE "VendorContact" ADD COLUMN "pendingAccountNumber" TEXT;
ALTER TABLE "VendorContact" ADD COLUMN "pendingBankEffectiveAt" TIMESTAMP(3);
