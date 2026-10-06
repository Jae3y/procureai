-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentReference" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "amountKobo" BIGINT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "failureReason" TEXT,
    "koraResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Refund_reference_key" ON "Refund"("reference");

-- CreateIndex
CREATE INDEX "Refund_orderId_idx" ON "Refund"("orderId");

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Refund invariants (same rules as payouts).
ALTER TABLE "Refund" ADD CONSTRAINT "I7_refund_amount" CHECK ("amountKobo" > 0);
ALTER TABLE "Refund" ADD CONSTRAINT "I8_refund_resolved_has_raw" CHECK ("status" = 'PENDING' OR "koraResponse" IS NOT NULL);
CREATE UNIQUE INDEX "refund_one_live_per_order" ON "Refund" ("orderId") WHERE "status" <> 'FAILED';

CREATE FUNCTION procureai_refund_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."amountKobo" IS DISTINCT FROM OLD."amountKobo" OR NEW."reference" IS DISTINCT FROM OLD."reference"
     OR NEW."orderId" IS DISTINCT FROM OLD."orderId" OR NEW."paymentReference" IS DISTINCT FROM OLD."paymentReference" THEN
    RAISE EXCEPTION 'refund amount, reference and source are immutable' USING ERRCODE = 'P0001';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND OLD."status" <> 'PENDING' THEN
    RAISE EXCEPTION 'refund % is already % and cannot become %', OLD."reference", OLD."status", NEW."status" USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "refund_update_guard" BEFORE UPDATE ON "Refund" FOR EACH ROW EXECUTE FUNCTION procureai_refund_update();
CREATE TRIGGER "refund_no_delete" BEFORE DELETE ON "Refund" FOR EACH ROW EXECUTE FUNCTION procureai_forbid_mutation('REFUND');
