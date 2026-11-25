-- Sign-up method and first-touch attribution, for the daily growth stats. All nullable: older accounts keep NULL.
ALTER TABLE "Account" ADD COLUMN "signupMethod" TEXT;
ALTER TABLE "Account" ADD COLUMN "utmSource" TEXT;
ALTER TABLE "Account" ADD COLUMN "utmMedium" TEXT;
ALTER TABLE "Account" ADD COLUMN "utmCampaign" TEXT;
ALTER TABLE "Account" ADD COLUMN "referrerHost" TEXT;

-- The growth stats count accounts per day.
CREATE INDEX "Account_createdAt_idx" ON "Account"("createdAt");

-- ...and each order's first HELD transition (when its pay-in succeeded), without scanning the whole audit table.
CREATE INDEX "OrderTransition_toState_orderId_at_idx" ON "OrderTransition"("toState", "orderId", "at");
