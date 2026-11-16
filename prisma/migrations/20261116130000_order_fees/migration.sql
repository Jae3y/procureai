-- ProcureAI's fees on an order (revenue model v2). Both default to 0, so every existing order is unchanged.
ALTER TABLE "Order" ADD COLUMN "buyerFeeKobo" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "sellerFeeKobo" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD CONSTRAINT "I7_order_fees" CHECK ("buyerFeeKobo" >= 0 AND "sellerFeeKobo" >= 0 AND "sellerFeeKobo" < "amountKobo");

-- Fees are fixed when the buyer approves: what they were shown is what they pay, and what the vendor was promised
-- is what they get. Nothing can change them afterwards.
CREATE OR REPLACE FUNCTION "fees_frozen"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."buyerFeeKobo" <> OLD."buyerFeeKobo" OR NEW."sellerFeeKobo" <> OLD."sellerFeeKobo" THEN
    RAISE EXCEPTION 'I7: an order''s fees are fixed at approval (order %)', OLD."id";
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "I7_fees_frozen" BEFORE UPDATE ON "Order" FOR EACH ROW EXECUTE FUNCTION "fees_frozen"();
