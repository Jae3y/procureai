-- Founding Vendor numbers: the first real businesses to register.
ALTER TABLE "VendorContact" ADD COLUMN "foundingNumber" INTEGER;
CREATE UNIQUE INDEX "VendorContact_foundingNumber_key" ON "VendorContact"("foundingNumber");
