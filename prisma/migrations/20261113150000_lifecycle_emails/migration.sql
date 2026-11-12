ALTER TABLE "Account" ADD COLUMN "emailsOffAt" TIMESTAMP(3);

-- One row per lifecycle email sent, so none is ever sent twice.
CREATE TABLE "LifecycleEmail" (
    "id" BIGSERIAL NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LifecycleEmail_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LifecycleEmail_accountId_kind_ref_key" ON "LifecycleEmail"("accountId", "kind", "ref");
CREATE INDEX "LifecycleEmail_accountId_sentAt_idx" ON "LifecycleEmail"("accountId", "sentAt");
ALTER TABLE "LifecycleEmail" ADD CONSTRAINT "LifecycleEmail_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
