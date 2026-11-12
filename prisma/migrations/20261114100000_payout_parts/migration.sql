-- A stage bigger than the payment provider's per-transfer maximum (NGN 10,000,000) is paid as several transfers ("parts").
ALTER TABLE "Payout" ADD COLUMN "part" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Payout" ADD CONSTRAINT "payout_part_positive" CHECK ("part" BETWEEN 1 AND 50);

-- I2 (widened): one live payout per (order, stage, part). A retry still needs the previous attempt FAILED first.
DROP INDEX "I2_one_live_payout_per_stage";
CREATE UNIQUE INDEX "I2_one_live_payout_per_stage_part" ON "Payout" ("orderId", "stage", "part") WHERE "status" <> 'FAILED';

-- A payout's part is as immutable as its amount and reference.
CREATE OR REPLACE FUNCTION procureai_payout_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."destinationBankCode" IS DISTINCT FROM OLD."destinationBankCode"
     OR NEW."destinationAccount" IS DISTINCT FROM OLD."destinationAccount"
     OR NEW."route" IS DISTINCT FROM OLD."route"
     OR NEW."verificationId" IS DISTINCT FROM OLD."verificationId"
     OR NEW."amountKobo" IS DISTINCT FROM OLD."amountKobo"
     OR NEW."reference" IS DISTINCT FROM OLD."reference"
     OR NEW."orderId" IS DISTINCT FROM OLD."orderId"
     OR NEW."stage" IS DISTINCT FROM OLD."stage"
     OR NEW."part" IS DISTINCT FROM OLD."part"
     OR NEW."retryOfId" IS DISTINCT FROM OLD."retryOfId" THEN
    RAISE EXCEPTION 'I4: a payout''s destination, amount and reference are immutable once written' USING ERRCODE = 'P0001';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND OLD."status" <> 'PENDING' THEN
    RAISE EXCEPTION 'payout % is already % and cannot become %', OLD."reference", OLD."status", NEW."status" USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
