-- CreateEnum
CREATE TYPE "MessageSender" AS ENUM ('BUYER', 'VENDOR');

-- CreateTable
CREATE TABLE "OrderMessage" (
    "id" BIGSERIAL NOT NULL,
    "orderId" TEXT NOT NULL,
    "sender" "MessageSender" NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderMessage_orderId_id_idx" ON "OrderMessage"("orderId", "id");

-- AddForeignKey
ALTER TABLE "OrderMessage" ADD CONSTRAINT "OrderMessage_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Messages are short text: 1-300 characters after trimming.
ALTER TABLE "OrderMessage" ADD CONSTRAINT "message_body_length" CHECK (char_length(btrim("body")) BETWEEN 1 AND 300);
