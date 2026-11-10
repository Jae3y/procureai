-- Which version of the terms each account accepted, and when.
ALTER TABLE "Account" ADD COLUMN "termsAcceptedAt" TIMESTAMP(3);
ALTER TABLE "Account" ADD COLUMN "termsVersion" TEXT;
