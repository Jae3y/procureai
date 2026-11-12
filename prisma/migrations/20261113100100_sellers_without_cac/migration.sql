-- The name on the seller's bank account, used to check the account when there is no CAC registration to check against.
ALTER TABLE "VendorContact" ADD COLUMN "ownerName" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "ownerName" TEXT;

-- A registered profile no longer needs a CAC number; it still needs the bank details and an email.
ALTER TABLE "VendorContact" DROP CONSTRAINT "registered_profile_complete";
ALTER TABLE "VendorContact" ADD CONSTRAINT "registered_profile_complete" CHECK (
  "registeredAt" IS NULL OR ("bankCode" IS NOT NULL AND "accountNumber" IS NOT NULL AND "email" IS NOT NULL AND ("rcNumber" IS NOT NULL OR "ownerName" IS NOT NULL))
);

-- VERIFIED still needs the bank's own confirmation of the account. A CAC-registered vendor also needs an active registration;
-- a seller verified by account owner has no CAC record, but the bank must have resolved the account name.
ALTER TABLE "VendorVerification" DROP CONSTRAINT "I8_verified_has_refs";
ALTER TABLE "VendorVerification" ADD CONSTRAINT "I8_verified_has_refs" CHECK (
  "verdict" <> 'VERIFIED' OR (
    "accountReference" IS NOT NULL AND "rawAccount" IS NOT NULL
    AND "matchMethod" <> 'NONE'
    AND (
      ("matchMethod" = 'ACCOUNT_OWNER' AND "accountName" IS NOT NULL)
      OR ("cacReference" IS NOT NULL AND upper("companyStatus") = 'ACTIVE')
    )
  )
);
