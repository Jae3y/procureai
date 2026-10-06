-- ProcureAI invariants, enforced by Postgres rather than by route code.
-- Each block is tagged with the invariant it implements (see ARCHITECTURE.md §Invariants).
-- Error messages start with the invariant id so tests and logs can assert on them.

-- ════════════════════════════════════════════════════════════════════════════
-- I7  Money is BIGINT kobo and never negative; amounts that move money are positive.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE "Request"     ADD CONSTRAINT "I7_request_budget"     CHECK ("budgetKobo" > 0 AND "quantity" > 0);
ALTER TABLE "Order"       ADD CONSTRAINT "I7_order_amounts"      CHECK ("amountKobo" > 0 AND "amountPaidKobo" >= 0 AND "amountAcceptedKobo" >= 0);
ALTER TABLE "PayIn"       ADD CONSTRAINT "I7_payin_amounts"      CHECK ("amountRequestedKobo" > 0 AND "amountExpectedKobo" > 0 AND "amountPaidKobo" >= 0 AND "amountAcceptedKobo" >= 0 AND ("feeKobo" IS NULL OR "feeKobo" >= 0));
ALTER TABLE "Payout"      ADD CONSTRAINT "I7_payout_amount"      CHECK ("amountKobo" > 0 AND ("feeKobo" IS NULL OR "feeKobo" >= 0));
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "I7_ledger_amount"      CHECK ("amountKobo" > 0);
ALTER TABLE "Quote"       ADD CONSTRAINT "I7_quote_amounts"      CHECK (
  ("unitPriceKobo" IS NULL OR "unitPriceKobo" > 0) AND ("totalKobo" IS NULL OR "totalKobo" > 0)
  AND ("deliveryKobo" IS NULL OR "deliveryKobo" >= 0)
  AND ("upfrontPercent" IS NULL OR "upfrontPercent" BETWEEN 0 AND 100));
ALTER TABLE "Order"       ADD CONSTRAINT "code_attempts_bounded" CHECK ("codeAttempts" BETWEEN 0 AND 5);

-- ════════════════════════════════════════════════════════════════════════════
-- I8  Rows produced by a Kora call keep the Kora reference and the raw response.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE "VendorVerification" ADD CONSTRAINT "I8_verification_raw" CHECK ("rawCac" IS NOT NULL);
ALTER TABLE "VendorVerification" ADD CONSTRAINT "I8_verified_has_refs" CHECK (
  "verdict" <> 'VERIFIED' OR (
    "cacReference" IS NOT NULL AND "accountReference" IS NOT NULL AND "rawAccount" IS NOT NULL
    AND "matchMethod" <> 'NONE' AND upper("companyStatus") = 'ACTIVE'));
ALTER TABLE "VendorVerification" ADD CONSTRAINT "verification_failed_has_reason" CHECK ("verdict" <> 'FAILED' OR "failureReason" IS NOT NULL);
ALTER TABLE "VendorVerification" ADD CONSTRAINT "verification_score_range" CHECK ("matchScoreBp" BETWEEN 0 AND 10000);
ALTER TABLE "Payout"      ADD CONSTRAINT "I8_payout_resolved_has_raw" CHECK ("status" = 'PENDING' OR "koraResponse" IS NOT NULL);
ALTER TABLE "PayIn"       ADD CONSTRAINT "I8_payin_reference" CHECK (length("reference") >= 8);
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "I8_ledger_reference" CHECK (length("koraReference") > 0);

-- ════════════════════════════════════════════════════════════════════════════
-- Append-only tables. TRUNCATE is not affected (row triggers), but nothing in the app truncates.
-- ════════════════════════════════════════════════════════════════════════════
CREATE FUNCTION procureai_forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '%: % rows are append-only', TG_ARGV[0], TG_TABLE_NAME USING ERRCODE = 'P0001';
END $$;

CREATE TRIGGER "I4_verification_append_only" BEFORE UPDATE OR DELETE ON "VendorVerification"
  FOR EACH ROW EXECUTE FUNCTION procureai_forbid_mutation('I4');
CREATE TRIGGER "ledger_append_only" BEFORE UPDATE OR DELETE ON "LedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION procureai_forbid_mutation('LEDGER');
CREATE TRIGGER "I5_transition_audit_append_only" BEFORE UPDATE OR DELETE ON "OrderTransition"
  FOR EACH ROW EXECUTE FUNCTION procureai_forbid_mutation('I5');
CREATE TRIGGER "order_event_append_only" BEFORE UPDATE OR DELETE ON "OrderEvent"
  FOR EACH ROW EXECUTE FUNCTION procureai_forbid_mutation('TIMELINE');

-- KoraEvent: only processing bookkeeping may change; what Kora sent is immutable.
CREATE FUNCTION procureai_kora_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'I6: KoraEvent rows cannot be deleted' USING ERRCODE = 'P0001';
  END IF;
  IF NEW."type" IS DISTINCT FROM OLD."type" OR NEW."reference" IS DISTINCT FROM OLD."reference"
     OR NEW."source" IS DISTINCT FROM OLD."source" OR NEW."idempotencyHash" IS DISTINCT FROM OLD."idempotencyHash"
     OR NEW."payload"::text IS DISTINCT FROM OLD."payload"::text OR NEW."rawBody" IS DISTINCT FROM OLD."rawBody"
     OR NEW."signatureHeader" IS DISTINCT FROM OLD."signatureHeader" OR NEW."signatureValid" IS DISTINCT FROM OLD."signatureValid" THEN
    RAISE EXCEPTION 'I6: the received content of a KoraEvent is immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "I6_kora_event_immutable" BEFORE UPDATE OR DELETE ON "KoraEvent"
  FOR EACH ROW EXECUTE FUNCTION procureai_kora_event_immutable();

-- ════════════════════════════════════════════════════════════════════════════
-- I4  A verified vendor's bank/RC details are frozen. A change needs a NEW verification row.
-- ════════════════════════════════════════════════════════════════════════════
CREATE FUNCTION procureai_vendor_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."bankCode" IS DISTINCT FROM OLD."bankCode"
      OR NEW."accountNumber" IS DISTINCT FROM OLD."accountNumber"
      OR NEW."rcNumber" IS DISTINCT FROM OLD."rcNumber")
     AND EXISTS (SELECT 1 FROM "VendorVerification" v WHERE v."vendorId" = OLD."id" AND v."verdict" = 'VERIFIED') THEN
    RAISE EXCEPTION 'I4: vendor % is verified; its bank and RC details are immutable. New details need a new verification.', OLD."id"
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "I4_vendor_freeze" BEFORE UPDATE ON "Vendor"
  FOR EACH ROW EXECUTE FUNCTION procureai_vendor_freeze();

-- ════════════════════════════════════════════════════════════════════════════
-- I1  Orders and payouts can only reference the vendor's LATEST verification, and it must be
--     VERIFIED. A payout goes to that verification's account, or (test mode only) to one of
--     Kora's documented sandbox payout accounts.
-- ════════════════════════════════════════════════════════════════════════════
CREATE FUNCTION procureai_assert_latest_verified(p_verification_id text, p_vendor_id text, p_what text)
RETURNS "VendorVerification" LANGUAGE plpgsql AS $$
DECLARE
  v "VendorVerification";
  latest_id text;
BEGIN
  SELECT * INTO v FROM "VendorVerification" WHERE "id" = p_verification_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'I1: % references a verification that does not exist', p_what USING ERRCODE = 'P0001';
  END IF;
  IF v."vendorId" IS DISTINCT FROM p_vendor_id THEN
    RAISE EXCEPTION 'I1: % references a verification for a different vendor', p_what USING ERRCODE = 'P0001';
  END IF;
  SELECT "id" INTO latest_id FROM "VendorVerification" WHERE "vendorId" = p_vendor_id ORDER BY "seq" DESC LIMIT 1;
  IF v."verdict" <> 'VERIFIED' OR latest_id IS DISTINCT FROM v."id" THEN
    RAISE EXCEPTION 'I1: % requires the vendor''s latest verification to be VERIFIED', p_what USING ERRCODE = 'P0001';
  END IF;
  RETURN v;
END $$;

CREATE FUNCTION procureai_order_verified() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM procureai_assert_latest_verified(NEW."verificationId", NEW."vendorId", 'order');
  RETURN NEW;
END $$;
CREATE TRIGGER "I1_order_verified" BEFORE INSERT ON "Order"
  FOR EACH ROW EXECUTE FUNCTION procureai_order_verified();

CREATE FUNCTION procureai_order_identity_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."vendorId" IS DISTINCT FROM OLD."vendorId" OR NEW."verificationId" IS DISTINCT FROM OLD."verificationId"
     OR NEW."quoteId" IS DISTINCT FROM OLD."quoteId" OR NEW."amountKobo" IS DISTINCT FROM OLD."amountKobo"
     OR NEW."requestId" IS DISTINCT FROM OLD."requestId" THEN
    RAISE EXCEPTION 'I1: an order''s vendor, verification, quote and amount are fixed at approval' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "I1_order_identity_frozen" BEFORE UPDATE ON "Order"
  FOR EACH ROW EXECUTE FUNCTION procureai_order_identity_frozen();

ALTER TABLE "Payout" ADD CONSTRAINT "I1_sandbox_route_accounts" CHECK (
  "route" <> 'SANDBOX_TEST_ACCOUNT' OR
  ("destinationBankCode" = '033' AND "destinationAccount" = '0000000000') OR
  ("destinationBankCode" = '035' AND "destinationAccount" = '0000000000') OR
  ("destinationBankCode" = '011' AND "destinationAccount" = '9999999999'));

CREATE FUNCTION procureai_payout_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  o "Order";
  v "VendorVerification";
  live_total bigint;
BEGIN
  -- Serialise every payout write for this order behind the order row lock (also taken by the app).
  SELECT * INTO o FROM "Order" WHERE "id" = NEW."orderId" FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'I1: payout % has no order', NEW."reference" USING ERRCODE = 'P0001';
  END IF;
  IF NEW."verificationId" IS DISTINCT FROM o."verificationId" THEN
    RAISE EXCEPTION 'I1: payout must use the verification the order was approved with' USING ERRCODE = 'P0001';
  END IF;
  v := procureai_assert_latest_verified(NEW."verificationId", o."vendorId", 'payout ' || NEW."reference");
  IF NEW."route" = 'VERIFIED_ACCOUNT'
     AND (NEW."destinationBankCode" IS DISTINCT FROM v."bankCode" OR NEW."destinationAccount" IS DISTINCT FROM v."accountNumber") THEN
    RAISE EXCEPTION 'I1: payout destination must be the verified account' USING ERRCODE = 'P0001';
  END IF;
  IF NEW."status" <> 'PENDING' THEN
    RAISE EXCEPTION 'payout must be created PENDING' USING ERRCODE = 'P0001';
  END IF;

  -- I3: live (non-failed) payouts can never exceed what Kora accepted for this order.
  SELECT COALESCE(SUM("amountKobo"), 0) INTO live_total FROM "Payout"
    WHERE "orderId" = NEW."orderId" AND "status" <> 'FAILED';
  IF live_total + NEW."amountKobo" > o."amountAcceptedKobo" THEN
    RAISE EXCEPTION 'I3: payouts (% + %) would exceed the accepted amount % for order %',
      live_total, NEW."amountKobo", o."amountAcceptedKobo", o."id" USING ERRCODE = 'P0001';
  END IF;
  IF live_total + NEW."amountKobo" > o."amountKobo" THEN
    RAISE EXCEPTION 'I3: payouts would exceed the order total for order %', o."id" USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "I1_I3_payout_insert" BEFORE INSERT ON "Payout"
  FOR EACH ROW EXECUTE FUNCTION procureai_payout_insert();

-- I4 (payout side): a payout's destination, amount, reference and lineage are immutable;
-- status only moves PENDING → SUCCESS | FAILED.
CREATE FUNCTION procureai_payout_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."destinationBankCode" IS DISTINCT FROM OLD."destinationBankCode"
     OR NEW."destinationAccount" IS DISTINCT FROM OLD."destinationAccount"
     OR NEW."route" IS DISTINCT FROM OLD."route"
     OR NEW."verificationId" IS DISTINCT FROM OLD."verificationId"
     OR NEW."amountKobo" IS DISTINCT FROM OLD."amountKobo"
     OR NEW."reference" IS DISTINCT FROM OLD."reference"
     OR NEW."orderId" IS DISTINCT FROM OLD."orderId"
     OR NEW."stage" IS DISTINCT FROM OLD."stage"
     OR NEW."retryOfId" IS DISTINCT FROM OLD."retryOfId" THEN
    RAISE EXCEPTION 'I4: a payout''s destination, amount and reference are immutable once written' USING ERRCODE = 'P0001';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND OLD."status" <> 'PENDING' THEN
    RAISE EXCEPTION 'payout % is already % and cannot become %', OLD."reference", OLD."status", NEW."status" USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "I4_payout_update" BEFORE UPDATE ON "Payout"
  FOR EACH ROW EXECUTE FUNCTION procureai_payout_update();
CREATE TRIGGER "payout_no_delete" BEFORE DELETE ON "Payout"
  FOR EACH ROW EXECUTE FUNCTION procureai_forbid_mutation('I4');

-- ════════════════════════════════════════════════════════════════════════════
-- I2  One live payout per (order, stage). A retry needs the previous attempt FAILED first.
-- ════════════════════════════════════════════════════════════════════════════
CREATE UNIQUE INDEX "I2_one_live_payout_per_stage" ON "Payout" ("orderId", "stage") WHERE "status" <> 'FAILED';

-- ════════════════════════════════════════════════════════════════════════════
-- I3 (order side)  The accepted amount can never drop below what is already committed.
-- ════════════════════════════════════════════════════════════════════════════
CREATE FUNCTION procureai_order_accepted_floor() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE live_total bigint;
BEGIN
  IF NEW."amountAcceptedKobo" < OLD."amountAcceptedKobo" THEN
    SELECT COALESCE(SUM("amountKobo"), 0) INTO live_total FROM "Payout"
      WHERE "orderId" = NEW."id" AND "status" <> 'FAILED';
    IF NEW."amountAcceptedKobo" < live_total THEN
      RAISE EXCEPTION 'I3: accepted amount % would fall below committed payouts %', NEW."amountAcceptedKobo", live_total
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "I3_order_accepted_floor" BEFORE UPDATE OF "amountAcceptedKobo" ON "Order"
  FOR EACH ROW EXECUTE FUNCTION procureai_order_accepted_floor();

-- ════════════════════════════════════════════════════════════════════════════
-- I5  Order status follows the state machine. The rule table mirrors lib/domain/state.ts.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO "OrderTransitionRule" ("fromState", "toState") VALUES
  ('CREATED',          'AWAITING_PAYMENT'),
  ('AWAITING_PAYMENT', 'UNDERPAID'),
  ('AWAITING_PAYMENT', 'HELD'),
  ('UNDERPAID',        'AWAITING_PAYMENT'),
  ('UNDERPAID',        'HELD'),
  ('HELD',             'STAGE_1_PAID'),
  ('HELD',             'DISPUTED'),
  ('STAGE_1_PAID',     'CODE_VERIFIED'),
  ('STAGE_1_PAID',     'PAYOUT_FAILED'),
  ('STAGE_1_PAID',     'DISPUTED'),
  ('CODE_VERIFIED',    'RELEASED'),
  ('RELEASED',         'COMPLETE'),
  ('RELEASED',         'PAYOUT_FAILED'),
  ('PAYOUT_FAILED',    'STAGE_1_PAID'),
  ('PAYOUT_FAILED',    'RELEASED'),
  ('DISPUTED',         'REFUNDED');

CREATE FUNCTION procureai_order_status_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'CREATED' THEN
      RAISE EXCEPTION 'I5: orders start in CREATED, not %', NEW."status" USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."status" IS NOT DISTINCT FROM OLD."status" THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "OrderTransitionRule" r WHERE r."fromState" = OLD."status" AND r."toState" = NEW."status") THEN
    RAISE EXCEPTION 'I5: illegal order transition % -> %', OLD."status", NEW."status" USING ERRCODE = 'P0001';
  END IF;
  -- Every status change must be explained by an audit row written in the same transaction.
  IF NOT EXISTS (
    SELECT 1 FROM "OrderTransition" t
    WHERE t."orderId" = NEW."id" AND t."fromState" = OLD."status" AND t."toState" = NEW."status"
      AND t."txId" = txid_current()
  ) THEN
    RAISE EXCEPTION 'I5: transition % -> % has no OrderTransition audit row in this transaction', OLD."status", NEW."status"
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "I5_order_status_guard" BEFORE INSERT OR UPDATE OF "status" ON "Order"
  FOR EACH ROW EXECUTE FUNCTION procureai_order_status_guard();

CREATE TRIGGER "I5_rules_frozen" BEFORE UPDATE OR DELETE OR INSERT ON "OrderTransitionRule"
  FOR EACH ROW EXECUTE FUNCTION procureai_forbid_mutation('I5');

-- ════════════════════════════════════════════════════════════════════════════
-- Ledger: HELD never goes negative (checked per entry), and every order's ledger balances
-- (checked at commit, so a balanced pair can be written as two inserts).
-- ════════════════════════════════════════════════════════════════════════════
CREATE FUNCTION procureai_ledger_held_floor() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE held bigint;
BEGIN
  PERFORM 1 FROM "Order" WHERE "id" = NEW."orderId" FOR UPDATE;
  IF NEW."account" = 'HELD' AND NEW."direction" = 'DEBIT' THEN
    SELECT COALESCE(SUM(CASE WHEN "direction" = 'CREDIT' THEN "amountKobo" ELSE -"amountKobo" END), 0)
      INTO held FROM "LedgerEntry" WHERE "orderId" = NEW."orderId" AND "account" = 'HELD';
    IF held - NEW."amountKobo" < 0 THEN
      RAISE EXCEPTION 'LEDGER: HELD for order % would go negative (% - %)', NEW."orderId", held, NEW."amountKobo"
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ledger_held_floor" BEFORE INSERT ON "LedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION procureai_ledger_held_floor();

CREATE FUNCTION procureai_ledger_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE net bigint;
BEGIN
  SELECT COALESCE(SUM(CASE WHEN "direction" = 'DEBIT' THEN "amountKobo" ELSE -"amountKobo" END), 0)
    INTO net FROM "LedgerEntry" WHERE "orderId" = NEW."orderId";
  IF net <> 0 THEN
    RAISE EXCEPTION 'LEDGER: order % ledger is unbalanced by % kobo at commit', NEW."orderId", net USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "ledger_balanced_at_commit" AFTER INSERT ON "LedgerEntry"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION procureai_ledger_balanced();

-- ════════════════════════════════════════════════════════════════════════════
-- SSE push: notify listeners when an order or request timeline gains a row.
-- ════════════════════════════════════════════════════════════════════════════
CREATE FUNCTION procureai_notify_timeline() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'OrderEvent' THEN
    PERFORM pg_notify('procureai_timeline', 'order:' || NEW."orderId");
  ELSE
    PERFORM pg_notify('procureai_timeline', 'request:' || NEW."requestId");
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER "order_event_notify" AFTER INSERT ON "OrderEvent"
  FOR EACH ROW EXECUTE FUNCTION procureai_notify_timeline();
CREATE TRIGGER "request_event_notify" AFTER INSERT ON "RequestEvent"
  FOR EACH ROW EXECUTE FUNCTION procureai_notify_timeline();
