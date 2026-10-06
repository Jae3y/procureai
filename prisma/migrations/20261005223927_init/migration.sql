-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('DRAFT', 'COLLECTING', 'VERIFYING', 'RECOMMENDED', 'APPROVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MatchMethod" AS ENUM ('COMPANY', 'DIRECTOR', 'NONE');

-- CreateEnum
CREATE TYPE "Verdict" AS ENUM ('VERIFIED', 'FAILED');

-- CreateEnum
CREATE TYPE "ParsedBy" AS ENUM ('AI', 'FALLBACK');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('CREATED', 'AWAITING_PAYMENT', 'UNDERPAID', 'HELD', 'STAGE_1_PAID', 'CODE_VERIFIED', 'RELEASED', 'COMPLETE', 'PAYOUT_FAILED', 'DISPUTED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PayInStatus" AS ENUM ('PROCESSING', 'SUCCESS', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PayoutStage" AS ENUM ('STAGE_1', 'STAGE_2');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "PayoutRoute" AS ENUM ('VERIFIED_ACCOUNT', 'SANDBOX_TEST_ACCOUNT');

-- CreateEnum
CREATE TYPE "LedgerAccount" AS ENUM ('BUYER_PAYIN', 'HELD', 'VENDOR_PAYOUT', 'FEE');

-- CreateEnum
CREATE TYPE "Direction" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "EventSource" AS ENUM ('WEBHOOK', 'API');

-- CreateEnum
CREATE TYPE "CauseType" AS ENUM ('WEBHOOK', 'POLLER', 'USER', 'ADMIN', 'SYSTEM');

-- CreateTable
CREATE TABLE "Buyer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Buyer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorContact" (
    "id" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Request" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "budgetKobo" BIGINT NOT NULL,
    "deadline" DATE NOT NULL,
    "specParsedBy" "ParsedBy" NOT NULL,
    "specModel" TEXT,
    "status" "RequestStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "contactId" TEXT,
    "label" TEXT NOT NULL,
    "name" TEXT,
    "rcNumber" TEXT,
    "bankCode" TEXT,
    "accountNumber" TEXT,
    "contactPhone" TEXT NOT NULL,
    "inviteTokenHash" TEXT NOT NULL,
    "inviteExpiresAt" TIMESTAMP(3) NOT NULL,
    "consentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorVerification" (
    "id" TEXT NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "vendorId" TEXT NOT NULL,
    "rcNumber" TEXT NOT NULL,
    "cacReference" TEXT,
    "registeredName" TEXT,
    "companyStatus" TEXT,
    "directors" JSONB NOT NULL,
    "bankCode" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "accountReference" TEXT,
    "accountName" TEXT,
    "matchMethod" "MatchMethod" NOT NULL,
    "matchScoreBp" INTEGER NOT NULL,
    "matchedPerson" TEXT,
    "verdict" "Verdict" NOT NULL,
    "failureReason" TEXT,
    "simulated" BOOLEAN NOT NULL,
    "rawCac" JSONB,
    "rawAccount" JSONB,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "rawReply" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unitPriceKobo" BIGINT,
    "totalKobo" BIGINT,
    "deliveryKobo" BIGINT,
    "quantityOffered" INTEGER,
    "upfrontPercent" INTEGER,
    "readyDate" DATE,
    "meetsSpec" BOOLEAN NOT NULL,
    "flags" JSONB NOT NULL,
    "parsedBy" "ParsedBy" NOT NULL,
    "model" TEXT,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "chosenQuoteId" TEXT,
    "rankedQuoteIds" JSONB NOT NULL,
    "reasoning" TEXT NOT NULL,
    "model" TEXT,
    "parsedBy" "ParsedBy" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "requestId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "amountKobo" BIGINT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'CREATED',
    "chargeReference" TEXT,
    "virtualAccount" JSONB,
    "amountPaidKobo" BIGINT NOT NULL DEFAULT 0,
    "amountAcceptedKobo" BIGINT NOT NULL DEFAULT 0,
    "handoverCodeHash" TEXT,
    "handoverCodeCipher" TEXT,
    "codeAttempts" INTEGER NOT NULL DEFAULT 0,
    "codeExpiresAt" TIMESTAMP(3),
    "codeUsedAt" TIMESTAMP(3),
    "payoutRoute" "PayoutRoute" NOT NULL DEFAULT 'VERIFIED_ACCOUNT',
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayIn" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "reference" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'bank_transfer',
    "amountRequestedKobo" BIGINT NOT NULL,
    "amountExpectedKobo" BIGINT NOT NULL,
    "amountPaidKobo" BIGINT NOT NULL DEFAULT 0,
    "amountAcceptedKobo" BIGINT NOT NULL DEFAULT 0,
    "feeKobo" BIGINT,
    "status" "PayInStatus" NOT NULL DEFAULT 'PROCESSING',
    "accountNumber" TEXT,
    "accountName" TEXT,
    "bankName" TEXT,
    "expiresAt" TIMESTAMP(3),
    "checkoutUrl" TEXT,
    "koraResponse" JSONB NOT NULL,
    "lastQueryResponse" JSONB,
    "lastQueriedAt" TIMESTAMP(3),
    "creditedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "stage" "PayoutStage" NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "reference" TEXT NOT NULL,
    "amountKobo" BIGINT NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "failureReason" TEXT,
    "retryOfId" TEXT,
    "route" "PayoutRoute" NOT NULL,
    "destinationBankCode" TEXT NOT NULL,
    "destinationAccount" TEXT NOT NULL,
    "feeKobo" BIGINT,
    "koraResponse" JSONB,
    "koraErrorKind" TEXT,
    "dispatchedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "orderId" TEXT NOT NULL,
    "account" "LedgerAccount" NOT NULL,
    "direction" "Direction" NOT NULL,
    "amountKobo" BIGINT NOT NULL,
    "koraReference" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KoraEvent" (
    "id" TEXT NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "source" "EventSource" NOT NULL,
    "signatureValid" BOOLEAN,
    "signatureMethod" TEXT,
    "idempotencyHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "rawBody" TEXT,
    "signatureHeader" TEXT,
    "orderId" TEXT,
    "demoNote" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "processError" TEXT,

    CONSTRAINT "KoraEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Outbox" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "doneAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "statusCode" INTEGER,
    "responseJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderTransitionRule" (
    "fromState" "OrderStatus" NOT NULL,
    "toState" "OrderStatus" NOT NULL,

    CONSTRAINT "OrderTransitionRule_pkey" PRIMARY KEY ("fromState","toState")
);

-- CreateTable
CREATE TABLE "OrderTransition" (
    "id" TEXT NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "orderId" TEXT NOT NULL,
    "fromState" "OrderStatus" NOT NULL,
    "toState" "OrderStatus" NOT NULL,
    "causeType" "CauseType" NOT NULL,
    "causeId" TEXT NOT NULL,
    "note" TEXT,
    "txId" BIGINT NOT NULL DEFAULT txid_current(),
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderEvent" (
    "id" BIGSERIAL NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "amountKobo" BIGINT,
    "koraReference" TEXT,
    "signature" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestEvent" (
    "id" BIGSERIAL NOT NULL,
    "requestId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "koraReference" TEXT,
    "signature" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "DemoSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DemoSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "VendorContact_phone_key" ON "VendorContact"("phone");

-- CreateIndex
CREATE INDEX "Request_buyerId_idx" ON "Request"("buyerId");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_inviteTokenHash_key" ON "Vendor"("inviteTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_requestId_label_key" ON "Vendor"("requestId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "VendorVerification_seq_key" ON "VendorVerification"("seq");

-- CreateIndex
CREATE INDEX "VendorVerification_vendorId_seq_idx" ON "VendorVerification"("vendorId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_vendorId_key" ON "Quote"("vendorId");

-- CreateIndex
CREATE INDEX "Quote_requestId_idx" ON "Quote"("requestId");

-- CreateIndex
CREATE INDEX "Recommendation_requestId_createdAt_idx" ON "Recommendation"("requestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_number_key" ON "Order"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Order_requestId_key" ON "Order"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_chargeReference_key" ON "Order"("chargeReference");

-- CreateIndex
CREATE UNIQUE INDEX "PayIn_reference_key" ON "PayIn"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "PayIn_orderId_sequence_key" ON "PayIn"("orderId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_reference_key" ON "Payout"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_retryOfId_key" ON "Payout"("retryOfId");

-- CreateIndex
CREATE INDEX "Payout_orderId_idx" ON "Payout"("orderId");

-- CreateIndex
CREATE INDEX "Payout_status_createdAt_idx" ON "Payout"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_seq_key" ON "LedgerEntry"("seq");

-- CreateIndex
CREATE INDEX "LedgerEntry_orderId_idx" ON "LedgerEntry"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_sourceType_sourceId_account_direction_key" ON "LedgerEntry"("sourceType", "sourceId", "account", "direction");

-- CreateIndex
CREATE UNIQUE INDEX "KoraEvent_seq_key" ON "KoraEvent"("seq");

-- CreateIndex
CREATE INDEX "KoraEvent_orderId_idx" ON "KoraEvent"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "KoraEvent_type_reference_idempotencyHash_key" ON "KoraEvent"("type", "reference", "idempotencyHash");

-- CreateIndex
CREATE UNIQUE INDEX "Outbox_eventId_key" ON "Outbox"("eventId");

-- CreateIndex
CREATE INDEX "Outbox_doneAt_nextAttemptAt_idx" ON "Outbox"("doneAt", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_key_key" ON "IdempotencyKey"("key");

-- CreateIndex
CREATE UNIQUE INDEX "OrderTransition_seq_key" ON "OrderTransition"("seq");

-- CreateIndex
CREATE INDEX "OrderTransition_orderId_seq_idx" ON "OrderTransition"("orderId", "seq");

-- CreateIndex
CREATE INDEX "OrderEvent_orderId_id_idx" ON "OrderEvent"("orderId", "id");

-- CreateIndex
CREATE INDEX "RequestEvent_requestId_id_idx" ON "RequestEvent"("requestId", "id");

-- AddForeignKey
ALTER TABLE "Request" ADD CONSTRAINT "Request_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "VendorContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorVerification" ADD CONSTRAINT "VendorVerification_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "VendorVerification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayIn" ADD CONSTRAINT "PayIn_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "VendorVerification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_retryOfId_fkey" FOREIGN KEY ("retryOfId") REFERENCES "Payout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KoraEvent" ADD CONSTRAINT "KoraEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Outbox" ADD CONSTRAINT "Outbox_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "KoraEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTransition" ADD CONSTRAINT "OrderTransition_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
