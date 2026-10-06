# Verified Kora endpoints

Every endpoint ProcureAI calls, read from Kora's own documentation on **5 October 2026**.
Raw snapshots of every page used are committed in `docs/kora-snapshots/` (Markdown guides via the
`.md` suffix, plus the full Postman API reference `kora-postman-collection.json` that backs
docs.korapay.com). Where two Kora sources disagree, both are quoted and the decision is in
DECISIONS.md and KORA_FEEDBACK.md.

Base URL: `https://api.korapay.com/merchant/api/v1` · Auth: `Authorization: Bearer <secret key>`
(source: checkout-redirect.md line 237; every Postman request uses `"type":"bearer"`).

All Kora responses share the envelope `{ status: boolean, message: string, data: ... }`. Errors
come back as `status:false` with an HTTP 4xx/5xx and sometimes a `code` (e.g. `AA021`) or a
field map in `data` (validation errors).

**Money fields are inconsistent in type across Kora's own examples** — the same field appears as
a JSON number (`1500`, `22.5`) and as a decimal string (`"100.00"`). Every Kora money field is
parsed by `lib/kora/schemas.ts#KoraMoney`, which accepts both and converts to integer kobo via
decimal-string arithmetic (never a float).

---

## Identity

### 1. CAC lookup
- **POST** `/identities/ng/cac`
- Doc: https://developers.korapay.com/docs/nigeria-certificate-incorporation.md (page updated 2026-09-21); Postman item `Identity/Nigeria/CAC Verification`
- Request:
  | field | type | required | note |
  |---|---|---|---|
  | `id` | string | yes | RC number, e.g. `RC00000011` |
  | `registration_type` | string | Postman: **required** (`RC`,`BN`,`IT`,`LP`,`LLP`); guide table: not listed, but present in the guide's own example | we always send `RC` for RC-prefixed ids |
  | `registration_name` | string | no | |
  | `verification_consent` | boolean | yes | must be `true`; captured from a UI checkbox |
- Response fields we depend on: `data.reference` (`VR-…`), `data.name`, `data.registration_number`, `data.company_status` (`"ACTIVE"`), `data.key_personnel[]{ name, designation, status }`.
- Designations seen in the doc example: `WITNESS`, `SECRETARY_COMPANY`, `DIRECTOR`, `SHAREHOLDER`, `PERSONS WITH SIGNIFICANT CONTROL`.
- Webhook: none. Identity lookups are synchronous.
- Sandbox: valid `RC00000011` → "John Doe Inc", ACTIVE, director `MICHAEL DOE`, shareholder `JOHN DOE`; invalid `RC11111111` (testing-your-integration.md, "For Nigeria" table). Needs test mode + test secret key (testing-identity-on-sandbox.md).

### 2. Fetch identity banks
- **GET** `/identities/ng/banks?type=basic` (also `?type=premium`; `type` is **required**)
- Doc: https://developers.korapay.com/docs/nigerian-bank-account-verification.md (updated 2026-08-05)
- Response: `data[]{ name, code }`. Doc warns: "Premium and Basic bank lists and code may differ" — GTB is `058` on basic and `000013` on premium.
- Usage: cached per process; populates the vendor bank picker and validates `bank_code` before the account call. A basic call with a premium code is rejected locally (`KoraValidationError`) before any network call.

### 3. Basic bank account lookup
- **POST** `/identities/ng/bank-account-basic`
- Doc: same page as above.
- Request: `id` (string, 10-digit NUBAN, required), `bank_code` (string, required, from the **basic** list), `verification_consent` (boolean, required, `true`).
- Response fields we depend on: `data.reference`, `data.id_type` (`ng_bank_account_basic`), `data.bank_details{ name, code }`, `data.account_details{ number, name }`.
- Sandbox: `0123456789` at `058` → `account_details.name = "MICHAEL JOHN DOE"`.
- Not used: `/identities/ng/bank-account` (premium; returns BVN + personal data we do not need) and `/identities/ng/bvn`.

### 4. Query a verification
- **GET** `/identities/verifications/:reference`
- Doc: https://developers.korapay.com/docs/managing-verifications.md
- Response: `data.reference`, `data.status` (`"found"`), `data.type`, `data.date_created`, plus id-type fields.
- Usage: the record page re-confirms stored `VR-` references exist (admin "re-confirm" on the reconciliation screen).

---

## Pay-in

### 5. Dynamic NGN bank-transfer charge (one-time account)
- **POST** `/charges/bank-transfer`
- Path source: Postman item `Pay-ins/Bank Transfer/Bank Transfer` (`https://api.korapay.com/merchant/api/v1/charges/bank-transfer`). The guide (bank-transfers.md) describes the body but only links to the Postman page for the path.
- Doc: https://developers.korapay.com/docs/bank-transfers.md
- Request:
  | field | type | required | note |
  |---|---|---|---|
  | `reference` | string | yes | ≥ 8 chars. We send `PA-<orderId>` |
  | `amount` | number | yes | naira, not kobo |
  | `currency` | string | yes | `NGN` only |
  | `customer.email` | string | yes | |
  | `customer.name` | string | no | |
  | `account_name` | string | no | shown when the account number is resolved |
  | `merchant_bears_cost` | boolean | no | default `false`; we send `true` so the buyer pays exactly the quote |
  | `narration` | string | no | |
  | `notification_url` | string | no | our `/api/webhooks/kora` |
  | `metadata` | object | no | ≤ 5 keys, key ≤ 20 chars, **allowed chars `A-Z a-z 0-9 -`** — so `order_id` is illegal; we send `orderId` |
  | `auto_complete` | boolean | no | sandbox only |
- Response fields we depend on: `data.reference`, `data.amount`, `data.amount_expected`, `data.fee`, `data.status` (`processing`), `data.bank_account{ account_name, account_number, bank_name, bank_code, expiry_date_in_utc }`.
- Errors documented: 400 validation (`data.<field>.message`), **409 duplicate reference** (`code: AA021`).
- Webhook: `charge.success` / `charge.failed`.
- Sandbox: "By default, transactions initiated via the bank transfer API on sandbox are completed automatically **after 2 minutes**." `auto_complete: false` disables that so the payment is triggered manually with the sandbox credit call (#7). We default to `auto_complete:false` so the demo is driven explicitly.
- Prerequisite noted by Kora: "you need to enable this feature on your account. Contact … support@korapay.com" — see BLOCKERS.md.

### 6. Query a charge (truthful amounts)
- **GET** `/charges/:reference`
- Doc: Postman `Pay-ins/Query Charge`; https://developers.korapay.com/docs/handling-underpayments-and-overpayments.md; virtual-bank-accounts-ngn.md
- Response fields we depend on: `data.reference`, `data.status` (`success` | `failed` | `expired` | `processing`), `data.amount`, `data.amount_paid`, `data.amount_accepted` (optional — absent in the Postman success example, present in the under/overpayment guide), `data.fee`, `data.bank_transfer.payment_event` (`underpayment`|`overpayment`, only when relevant).
- 404 `"Charge not found"` → `KoraNotFoundError`.
- Rule used (handling-underpayments-and-overpayments.md): "The `amount` in the webhook notification payload … will always be the amount you passed to Kora" and "You are expected to use the `amount_accepted` field to credit value". We credit from `amount_accepted`, falling back to `amount_paid` only when Kora omits `amount_accepted` (DECISIONS.md D-07).

### 7. Sandbox credit for a virtual account
- **POST** `/virtual-bank-account/sandbox/credit`
- Doc: virtual-bank-accounts-ngn.md "Crediting a Virtual Bank Account on the Sandbox Environment"; bank-transfers.md: "pass the account number returned from the bank transfer API and the amount"; Postman `Credit Sandbox Virtual Bank Account`.
- Request: `account_number` (string, required), `amount` (number, required, NGN 100 – 10,000,000), `currency` (string, required, `NGN`).
- Response: `{ status: true, message: "Virtual bank account credited successfully", data: null }`.
- Used by the admin "Pay this account (sandbox)" and "Force underpayment" controls.

### 8. Checkout Redirect (secondary, behind `ENABLE_CHECKOUT_REDIRECT`)
- **POST** `/charges/initialize`
- Doc: https://developers.korapay.com/docs/checkout-redirect.md; Postman `Pay-ins/Checkout Redirect/Initialize Charge`
- Request: `amount` (number, req), `currency` (req), `reference` (req, unique), `notification_url` (Postman: **required**), `redirect_url`, `channels` (e.g. `["bank_transfer","card"]`), `default_channel`, `narration`, `customer{ name, email }`, `merchant_bears_cost`, `metadata`.
- Response: `data.reference`, `data.checkout_url`.

---

## Payout

### 9. Single payout
- **POST** `/transactions/disburse`
- Doc: https://developers.korapay.com/docs/payout-via-api.md (updated 2026-06-07); Postman `Payouts/Single Payout/Single Payout to Bank Account`
- Request:
  | field | type | required | note |
  |---|---|---|---|
  | `reference` | string | guide: **required**, ≥ 5 chars; Postman table: "Optional" | we always send `PO-<orderId>-S1`/`-S2`, retries `-R<n>` |
  | `destination.type` | string | yes | `bank_account` |
  | `destination.amount` | number | yes | "two decimal places" (naira) |
  | `destination.currency` | string | yes | `NGN` |
  | `destination.narration` | string | no | |
  | `destination.bank_account.bank` | string | yes | payout bank code |
  | `destination.bank_account.account` | string | yes | |
  | `destination.customer.email` | string | yes | |
  | `destination.customer.name` | string | no | |
  | `metadata` | object | no | same ≤5-key rule |
  | `notification_url` | string | no | |
- Response fields: `data.reference`, `data.status` (`processing`), `data.amount`, `data.fee`.
- Errors documented: **409 `"Insufficient funds in disbursement wallet"`**, 404 `"bank not found"`, 400 validation.
- Kora's instruction (payout-via-api.md "Handling Unexpected Request Errors"): "DO NOT treat request errors such as 502 … 504 … 503 … 500 … as failed payout … verify the payout using the Payout Verification API". This is exactly our unknown-outcome rule: the Payout row stays `PENDING` and the poller resolves it with #10. The client never retries a disburse call.
- Sandbox (testing-your-integration.md): `033/0000000000` success, `035/0000000000` failed, `011/9999999999` invalid account. The field table adds: "bank codes … to simulate successful transactions in Test mode are 044, 033, 058".
- Webhook: `transfer.success` / `transfer.failed`.

### 10. Verify a payout
- **GET** `/transactions/:transactionReference`
- Doc: Postman `Payouts/Verify Payout Transaction`
- Response: `data.reference`, `data.status` (`success` | `failed` | `processing`), `data.amount`, `data.fee`, `data.message` (failure reason, e.g. "Timeout waiting for response from destination"), `data.trace_id`.

### 11. Payout bank list
- **GET** `/misc/banks?countryCode=NG`
- Doc: payout-via-api.md step 1; Postman `Miscellaneous/List Banks`
- Response: `data[]{ name, slug, code, nibss_bank_code, country }`.
- This is a **third** bank-code list, distinct from identity basic/premium. Used to validate a payout bank code.

### Not used
- `POST /transactions/disburse/bulk` (bulk-payouts-via-api.md): each order pays one vendor per stage, and stages are minutes apart, so batching gains nothing and complicates per-stage idempotency.

---

## Balance

### 12. Balances
- **GET** `/balances`
- Doc: https://developers.korapay.com/docs/balance-api.md; Postman `Balances/Get Balances`
- Response: `data.NGN{ pending_balance, available_balance }` (numbers in naira).
- Used before Stage 1 and on `/api/health`. Payouts draw on `available_balance`.

### 13. Balance history
- **GET** `/balances/history`
- Doc: https://developers.korapay.com/docs/balance-history-api.md; Postman `Balances/Get Balance History`
- Query: `currency`, `date_from`/`date_to` (`YYYY-MM-DD-HH-MM-SS`), `limit` (default 10, max 50 per Postman), `starting_after`/`ending_before` (pointer pagination), `direction` (`debit`|`credit`).
- Response **(two shapes in Kora's docs)**: Postman → `data.has_more` + `data.history[]{ pointer, amount, currency, balance_before, balance_after, date, description, direction, source, source_reference }`; guide → top-level `has_more` + a single `data{…, date_created }`. The schema accepts both.
- Used by the reconciliation screen: `source_reference` is joined to our charge/payout references.

---

## Webhooks

- Doc: https://developers.korapay.com/docs/webhooks.md
- Events: `charge.success`, `charge.failed`, `transfer.success`, `transfer.failed` (also `refund.*`, which we persist but don't act on).
- Payload: `{ event, data{ reference, amount, fee, currency, status, payment_reference?, payment_method?, transaction_date? } }`.
- Signature: header `x-korapay-signature` = hex HMAC-SHA256 of **only the `data` object**, keyed with the secret key. Kora's Node sample computes it over `JSON.stringify(req.body.data)`, a re-serialisation. We verify against the exact raw byte span of `data` in the body **and** against the re-serialised form, constant-time, accepting either (DECISIONS.md D-05).
- Delivery: respond `200`; any other code or a timeout → "we retry the request periodically within 72 hours".
- Where Kora sends them: per-request `notification_url` (charges, payouts) or the dashboard webhook URL (Settings → API Configuration).
- Not documented anywhere: `identity.*` webhook events. The design handoff mentions `identity.cac` / `identity.bvn_match`; Kora identity is synchronous, so identity rows in the events panel are labelled "Kora API" rather than "Signature verified".
