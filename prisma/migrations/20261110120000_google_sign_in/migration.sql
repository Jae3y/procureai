-- "Continue with Google": the Google account linked to a ProcureAI account.
ALTER TABLE "Account" ADD COLUMN "googleSub" TEXT;
CREATE UNIQUE INDEX "Account_googleSub_key" ON "Account"("googleSub");
