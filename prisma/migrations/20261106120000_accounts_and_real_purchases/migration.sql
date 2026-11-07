-- Real accounts, notifications, and a hard line between demo purchases and real ones. Additive only.

ALTER TABLE "Request" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;
-- Every purchase before accounts existed was made on the shared demo.
UPDATE "Request" SET "isDemo" = true;

ALTER TABLE "VendorContact" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;
UPDATE "VendorContact" SET "isDemo" = true WHERE "phone" IN ('+234 802 331 4410', '+234 805 207 9983', '+234 703 118 6652', '+234 806 540 2271', '+234 810 664 3905', '+234 807 922 1146', '+234 809 455 7728', '+234 704 389 0517', '+234 813 276 4402', '+234 816 803 5519', '+234 815 740 2236', '+234 802 651 8874', '+234 803 412 7781', '+234 816 090 2214', '+234 909 551 3046');

ALTER TABLE "Vendor" ADD COLUMN "addedByBuyer" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT,
    "sessionVersion" INTEGER NOT NULL DEFAULT 1,
    "buyerId" TEXT NOT NULL,
    "vendorContactId" TEXT,
    "emailVerifiedAt" TIMESTAMP(3),
    "deletionRequestedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Account_email_key" ON "Account"("email");
CREATE UNIQUE INDEX "Account_buyerId_key" ON "Account"("buyerId");
CREATE UNIQUE INDEX "Account_vendorContactId_key" ON "Account"("vendorContactId");
ALTER TABLE "Account" ADD CONSTRAINT "Account_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Account" ADD CONSTRAINT "Account_vendorContactId_fkey" FOREIGN KEY ("vendorContactId") REFERENCES "VendorContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AccountToken" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccountToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AccountToken_tokenHash_key" ON "AccountToken"("tokenHash");
CREATE INDEX "AccountToken_accountId_purpose_idx" ON "AccountToken"("accountId", "purpose");
ALTER TABLE "AccountToken" ADD CONSTRAINT "AccountToken_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT,
    "readAt" TIMESTAMP(3),
    "emailedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Notification_accountId_createdAt_idx" ON "Notification"("accountId", "createdAt");
CREATE INDEX "Notification_emailedAt_createdAt_idx" ON "Notification"("emailedAt", "createdAt");
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
