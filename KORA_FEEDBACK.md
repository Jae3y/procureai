# Feedback for Kora's engineers

Written while integrating identity, bank-transfer pay-ins, payouts, refunds, balance history and webhooks for ProcureAI
(October 2026). Every point cites the doc page snapshot in `docs/kora-snapshots/`. Ordered by how much time it cost.

## 1. Money fields change type between endpoints (and examples)
`amount`, `fee`, `amount_paid` arrive as JSON numbers in some responses (`"amount": 1500`, `"fee": 22.5`) and decimal strings
in others (`"amount": "100.00"`), sometimes for the same endpoint across examples (Query Charge, Verify Payout). Integrators
must accept both and avoid float parsing. **Ask:** one documented type (decimal string with 2 dp) everywhere, or say so per field.

## 2. Webhook signatures: re-serialisation and coverage
- The Node sample signs `JSON.stringify(req.body.data)` — a re-serialisation. If the sent body contains `150.00`, `JSON.stringify` produces `150` and the HMAC differs; the PHP sample needs `serialize_precision` tweaks for the same reason. **Ask:** document that the signature is over the exact `data` bytes as sent (or sign the raw body).
- Only `data` is signed, so `event` can be swapped under a valid signature, and there is no timestamp to bound replay. We compensate by re-querying Kora before acting. **Ask:** sign the full body + a timestamp header.

## 3. The bank-transfer guide omits the path
`docs/bank-transfers.md` gives the body and fields but only links to the Postman collection for the endpoint
(`POST /charges/bank-transfer`). It also says the API must be enabled by support — unclear whether that applies in test mode.
**Ask:** put the path on the page; state test-mode availability.

## 4. `amount_accepted` is the field to use — but the Query Charge example omits it
The under/overpayment guide says "You are expected to use the `amount_accepted` field to credit value", yet the Postman
"Query Charge — Successful Pay-In" example has no `amount_accepted`. We fall back to `amount_paid`. **Ask:** always return it.

## 5. CAC lookup: required fields disagree
Guide table: `id`, `registration_name`, `verification_consent`. Both the guide's own example and Postman send `registration_type`
(Postman marks it **required**), and Postman's example `id` is `"00000011"` while the guide and test data use `"RC00000011"`.
The error body for an invalid RC (sandbox `RC11111111`) isn't documented. **Ask:** one field table; document the not-found error.

## 6. Balance history has two documented shapes
Postman: `{ status, data: { has_more, history: [ { …, date } ] } }`. Guide: `{ has_more, data: { …, date_created } }` (single
object). We parse both. Also unclear: is `source_reference` our merchant reference or Kora's internal one (`KPY-…`)? That
decides how reconciliation joins. **Ask:** one shape; document `source_reference` per source.

## 7. Sandbox test data doesn't connect identity to payouts
Identity verifies only `058/0123456789` ("MICHAEL JOHN DOE"); payouts simulate only `033/035/011` with account `0000000000`
(plus a note that `044/033/058` succeed). An end-to-end "verify then pay" sandbox flow needs one account that works for both.
**Ask:** a documented account that verifies **and** pays out in test mode.

## 8. Metadata key rules
"Allowed characters: A-Z, a-z, 0-9, and -" — so the natural `order_id` is rejected. Easy to miss; a clear validation error
naming the key would help.

## 9. Three bank-code lists
Identity basic (`/identities/ng/banks?type=basic`), identity premium (`?type=premium`, different codes, e.g. GTB 058 vs 000013),
and payouts (`/misc/banks`). The docs warn about basic vs premium; a mapping between identity and payout codes would remove guesswork.

## 10. Smaller things
- No `identity.*` webhooks, while some design material assumes them; identity is synchronous — say so on the overview.
- Sandbox bank transfers auto-complete after 2 minutes unless `auto_complete: false` — great for demos, worth surfacing higher.
- Payout `reference` is "Optional" in the Postman table and "Required, ≥ 5 chars" in the guide.
- "Do not treat 5xx as failed payout — verify first" (payout guide) is exactly right; making it a callout on the endpoint page would prevent double payouts.

## 11. Discoveries from Live Sandbox Preflight (October 2026)
- **CAC `id` strictly validates against `/^\d+$/`**: Sending `"RC00000011"` (as documented in the guide) throws HTTP 400 validation error: `"id" with value "RC00000011" fails to match the required pattern: /^\d+$/`. Integrators must strip the `"RC"` prefix and send `"00000011"`.
- **Payout disburse rejects `notification_url`**: Sending `notification_url` on `POST /transactions/disburse` causes HTTP 400 with `"notification_url is not allowed"`. Webhooks are configured globally in merchant dashboard settings.
- **Minimum payout amount**: Disburse fails if amount is below ₦1,000 (`"Amount cannot be less than 1000"`). Test payloads must disburse at least 100,000 kobo.
- **Customer email domain validation**: Emails using mock TLDs like `.test` fail validation with `"customer.email must be a valid email"`.
- **`/misc/banks` requires Public Key**: `GET /misc/banks?countryCode=NG` must be authenticated with `Authorization: Bearer <PUBLIC_KEY>`, while transactional endpoints use the Secret Key.
- **Basic identity bank list returns empty in sandbox**: `GET /identities/ng/banks?type=basic` returns `data: []` in sandbox mode for new merchant accounts.
