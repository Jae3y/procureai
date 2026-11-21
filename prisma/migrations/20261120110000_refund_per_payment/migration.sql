-- An order paid in several transfers is refunded in several parts, one per payment. The old guard allowed one
-- live refund per ORDER, which made those orders unrefundable; it now allows one live refund per PAYMENT, and a
-- trigger makes sure the refunds against a payment never add up to more than that payment brought in.
DROP INDEX "refund_one_live_per_order";
CREATE UNIQUE INDEX "refund_one_live_per_payment" ON "Refund" ("orderId", "paymentReference") WHERE "status" <> 'FAILED';

CREATE FUNCTION procureai_refund_within_payment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  accepted BIGINT;
  refunded BIGINT;
BEGIN
  SELECT "amountAcceptedKobo" INTO accepted FROM "PayIn" WHERE "reference" = NEW."paymentReference" AND "orderId" = NEW."orderId";
  IF accepted IS NULL THEN
    RAISE EXCEPTION 'I7: refund % names a payment % that is not part of order %', NEW."reference", NEW."paymentReference", NEW."orderId" USING ERRCODE = 'P0001';
  END IF;
  SELECT COALESCE(SUM("amountKobo"), 0) INTO refunded FROM "Refund"
    WHERE "paymentReference" = NEW."paymentReference" AND "status" <> 'FAILED' AND "id" <> NEW."id";
  IF refunded + NEW."amountKobo" > accepted THEN
    RAISE EXCEPTION 'I7: refunds against % would exceed what it brought in', NEW."paymentReference" USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "I7_refund_within_payment" BEFORE INSERT ON "Refund" FOR EACH ROW EXECUTE FUNCTION procureai_refund_within_payment();
