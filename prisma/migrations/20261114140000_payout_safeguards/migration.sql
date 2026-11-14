-- Safeguards decided by the owner on 13 Nov 2026:
--  * a seller with fewer than 3 completed orders gets 10% as the first payout (instead of 30%), the rest on delivery;
--  * the first payout of a large order waits for the owner's approval (and, above a higher amount, 24 hours).
ALTER TABLE "Order" ADD COLUMN "stage1Bp" INTEGER NOT NULL DEFAULT 3000;
ALTER TABLE "Order" ADD COLUMN "payoutApprovedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD CONSTRAINT "order_stage1_share" CHECK ("stage1Bp" IN (1000, 3000));

-- I1 (widened): the first-payout share is fixed at approval, like the vendor, quote and amount.
CREATE OR REPLACE FUNCTION procureai_order_identity_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."vendorId" IS DISTINCT FROM OLD."vendorId" OR NEW."verificationId" IS DISTINCT FROM OLD."verificationId"
     OR NEW."quoteId" IS DISTINCT FROM OLD."quoteId" OR NEW."amountKobo" IS DISTINCT FROM OLD."amountKobo"
     OR NEW."requestId" IS DISTINCT FROM OLD."requestId" OR NEW."stage1Bp" IS DISTINCT FROM OLD."stage1Bp" THEN
    RAISE EXCEPTION 'I1: an order''s vendor, verification, quote, amount and payout split are fixed at approval' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
