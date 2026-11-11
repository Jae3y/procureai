-- Richer sign-up: phone, what the person will do, organisation, how they heard of us, marketing consent.
ALTER TABLE "Account" ADD COLUMN "phone" TEXT;
ALTER TABLE "Account" ADD COLUMN "intent" TEXT;
ALTER TABLE "Account" ADD COLUMN "organisation" TEXT;
ALTER TABLE "Account" ADD COLUMN "heardFrom" TEXT;
ALTER TABLE "Account" ADD COLUMN "marketingConsentAt" TIMESTAMP(3);
