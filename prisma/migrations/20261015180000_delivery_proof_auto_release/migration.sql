-- CreateEnum
CREATE TYPE "EvidenceKind" AS ENUM ('DELIVERY', 'DISPUTE');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "autoReleaseAt" TIMESTAMP(3),
ADD COLUMN     "deliveredAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "OrderEvidence" (
    "id" BIGSERIAL NOT NULL,
    "orderId" TEXT NOT NULL,
    "party" "MessageSender" NOT NULL,
    "kind" "EvidenceKind" NOT NULL,
    "note" TEXT NOT NULL,
    "photo" BYTEA,
    "photoType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderEvidence_orderId_id_idx" ON "OrderEvidence"("orderId", "id");

-- AddForeignKey
ALTER TABLE "OrderEvidence" ADD CONSTRAINT "OrderEvidence_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Evidence is short and small: a note of 1–500 characters, an optional photo of at most 700 KB.
ALTER TABLE "OrderEvidence" ADD CONSTRAINT "evidence_note_length" CHECK (char_length(btrim("note")) BETWEEN 1 AND 500);
ALTER TABLE "OrderEvidence" ADD CONSTRAINT "evidence_photo_size" CHECK ("photo" IS NULL OR octet_length("photo") <= 716800);
ALTER TABLE "OrderEvidence" ADD CONSTRAINT "evidence_photo_type" CHECK (("photo" IS NULL AND "photoType" IS NULL) OR "photoType" IN ('image/jpeg', 'image/png', 'image/webp'));
-- A release date only exists alongside a delivery date.
ALTER TABLE "Order" ADD CONSTRAINT "delivery_release_pair" CHECK (("deliveredAt" IS NULL) = ("autoReleaseAt" IS NULL));

-- I5: a dispute can now also be resolved in the vendor's favour (Stage 2 is then released as if the code
-- had been entered). The rule table is frozen by trigger; lift it for this one row only.
ALTER TABLE "OrderTransitionRule" DISABLE TRIGGER "I5_rules_frozen";
INSERT INTO "OrderTransitionRule" ("fromState", "toState") VALUES ('DISPUTED', 'CODE_VERIFIED');
ALTER TABLE "OrderTransitionRule" ENABLE TRIGGER "I5_rules_frozen";
