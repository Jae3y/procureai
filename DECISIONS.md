# Decisions

Every non-obvious call made while building ProcureAI: what was decided, why, and what it costs.
Owner answers are marked **(owner)**.

## Platform

**D-01 · Stack versions.** Next 16.3.8, React 19.3, Prisma **7.10.0** (npm's `latest` tag points at an 8.0 release candidate, so the stable 7.x is pinned), Zod 4, Vitest 5, Playwright 1.63, TypeScript **5.9.3** (TypeScript 7 is the new native compiler and Next's build still calls the TypeScript JS API). Exact pins in `package.json`.

**D-02 · Matching rule tightened in two places.** The spec's rule is "every token of the shorter name appears in the longer". Applied symmetrically to the company name, the required case *"John Doe Inc" + "MICHAEL JOHN DOE" → DIRECTOR* actually resolves as **COMPANY**: `{JOHN, DOE}` is inside `{MICHAEL, JOHN, DOE}`. So:
1. **COMPANY is one-directional.** Every account-name token must appear in the registered name. A personal account whose holder's name merely *contains* the company name is not the company's account. The symmetric rule would let anyone named "X Y Z" pass as company "Y Z Ltd".
2. **The shorter side needs ≥ 2 tokens** (unless both are single tokens), so a bare surname never verifies.

People (DIRECTOR/SHAREHOLDER) keep the spec's symmetric rule, which handles middle names on either side. Key personnel with a non-ACTIVE status (e.g. resigned) are ignored. A designation *containing* DIRECTOR counts ("MANAGING DIRECTOR"). WITNESS, SECRETARY and PERSONS WITH SIGNIFICANT CONTROL do not. Ties prefer DIRECTOR over SHAREHOLDER. `matchScoreBp` stores |A∩B| / |A∪B| in basis points (integer, no float).

**D-03 · Sandbox payout route.** Kora's sandbox identity test data (`058/0123456789` → "MICHAEL JOHN DOE") and its payout test accounts (`033/0000000000` succeeds, `035/0000000000` fails) are different accounts. Kora's payout guide says 058 also "simulates successful transactions in Test mode", so **by default payouts go to the verified account**. The admin "force payout failure" switch (and a fallback "033 success" route) sends the next payout to one of Kora's documented test accounts instead. This is enforced, not trusted:
- `Payout.route = SANDBOX_TEST_ACCOUNT` is only possible with a `sk_test_` key, and a DB CHECK (`I1_sandbox_route_accounts`) pins those payouts to exactly the three documented sandbox accounts.
- Every such payout shows "sandbox route 035/0000000000" in the timeline, the admin view and the record.
- With a live key the route is always the verified account.

**D-04 · Port 5434.** 5432 is the local Postgres service and 5433 belongs to another project on this machine, so docker-compose maps `5434:5432`.

**D-05 · Webhook signature checked two ways.** Kora signs `data` only. Kora's own Node sample re-serialises (`JSON.stringify(req.body.data)`), which can disagree with the bytes sent (`150.00` → `150`). We HMAC the exact raw byte span of `data` (a small non-evaluating scanner extracts it) and also Kora's re-serialised form, and accept either in constant time. Both require the secret key. `signatureMethod` records which matched.

**D-06 · Webhook dedupe hash includes the verdict.** I6's idempotency hash is `sha256(signatureValid + raw data bytes)`. A forged copy delivered first therefore lands in its own row and cannot shadow the genuine delivery. There's a test for exactly that.

**D-07 · Crediting a charge.** Money is credited only from `GET /charges/:reference`, never from the webhook. We use `amount_accepted`, falling back to `amount_paid` only when Kora omits `amount_accepted`; Kora's own Postman success example omits it.

**D-08 · `merchant_bears_cost: true`.** The buyer transfers exactly the quoted total, matching the design's ₦1,260,000. Kora's pay-in and payout fees are ProcureAI's cost and are recorded on the PayIn/Payout rows (`feeKobo`). The escrow ledger (BUYER_PAYIN → HELD → VENDOR_PAYOUT) therefore always holds exactly what the buyer paid. The `FEE` account exists for a buyer-borne fee configuration and has no entries in this one. The reconciliation screen shows Kora's fee lines as explained, not unmatched.

**D-09 · Metadata key is `orderId`, not `order_id`.** Kora's metadata keys allow `A-Z a-z 0-9 -` only, so `order_id` is illegal. The client rejects illegal keys before calling Kora.

**D-10 · `auto_complete: false` on sandbox charges.** By default Kora completes sandbox bank transfers automatically after 2 minutes. We turn that off so the demo (and the admin "pay this account" control, which uses Kora's sandbox credit API) decides exactly when money arrives.

**D-11 · Payout email.** Kora requires `destination.customer.email` on every payout. The vendor form collects a business email (the handoff screen has no such field, so this is an addition), and dispatch refuses with a precise message if it is missing. No placeholder emails are ever sent.

**D-12 · Stage 1 is dispatched when money is HELD.** The spec says "30% on approval", and the prototype animates Paid → Held → Stage 1 automatically. The handoff's copy "Waiting for the vendor to accept" / "when they accept the order" implies a vendor-acceptance step that has no screen in the handoff and no definition in the spec. The tracker and pay copy therefore say what actually happens (see UI additions).

**D-13 · State semantics.** `STAGE_1_PAID` and `RELEASED` are entered when that stage's payout is **dispatched**, with the PENDING row written in the same transaction, because the spec's failure edges (`STAGE_1_PAID|RELEASED → PAYOUT_FAILED`) only make sense that way. Whether money has *landed* is the payout's own status. That is what the Money Trail and the vendor screens render, so the trail never runs ahead of Kora. The delivery code is only accepted once Stage 1 is `SUCCESS`.

**D-14 · UNDERPAID stays UNDERPAID while the rest is outstanding.** When Kora accepts a partial payment, a second one-time account for the shortfall is opened automatically (`PA-<orderId>-T2`) and the order stays `UNDERPAID` until the full amount is accepted. Kora's dynamic accounts are single-use, so the handoff's "send ₦60,000 more to the *same* account" becomes "to this account", showing the new account number. With Kora's default "Return all" preference, an underpayment is reversed to the payer and nothing is held. The order stays `AWAITING_PAYMENT`, and the timeline says so.

**D-15 · Overpayment.** With Kora's "Accept all" preference, the excess is credited to HELD. The vendor is paid exactly the order total, and the record shows the excess as "held for refund to the buyer". With Kora's default "Return excess", Kora reverses the excess itself and `amount_accepted` equals the order total.

**D-16 · I5 audit tied to the transaction.** The trigger that guards `Order.status` requires an `OrderTransition` row written by the **same transaction** (`txId = txid_current()`). A raw `UPDATE` that skips `transition()` is rejected even when the move itself is legal. Timestamps were rejected as the link because Prisma may set them client-side.

**D-17 · Unknown-outcome payouts.** Following Kora's own instruction ("DO NOT treat … 502, 504, 503, 500 … as failed payout"), a timeout, 5xx or malformed 2xx on disburse leaves the payout `PENDING`. The poller resolves it 30s later with `GET /transactions/:reference`. If Kora answers **not found** after 30s, Kora never received it: the payout is marked `FAILED` ("Kora has no record of this payout, so it was never sent.") and only then can it be retried under a new reference. Disburse and sandbox-credit calls are never retried by the client. Charge creation is retried with the **same** reference: a landed earlier attempt surfaces as 409 `AA021`, and we then open a fresh reference.

**D-18 · Query outside the lock, apply under it.** Reconciliation asks Kora first (no DB lock held during network I/O), then applies the answer under `SELECT … FOR UPDATE`. Applying is idempotent and monotonic: a PayIn or Payout leaves its pending state exactly once and stale answers are no-ops. The webhook worker, the poller and the Re-check button all call the same `reconcileCharge` / `reconcilePayout`.

**D-19 · Signed transfer webhooks.** For payouts, the signed webhook's status is Kora's own statement, but we still query `GET /transactions/:reference` and prefer a conclusive query answer. The webhook status is used only if the query is inconclusive (still processing or erroring).

**D-20 · Webhook handler always answers 200.** This includes when storage fails. The raw body is then logged at error level for replay, and the poller still converges the order by querying Kora. Kora's 72-hour retry would help in a DB outage, but the spec explicitly forbids 5xx, and the poller covers it.

**D-21 · Self-healing poller.** Follow-ups that run after a commit (dispatch Stage 1, open a top-up account, dispatch Stage 2) are re-attempted by the poller if a crash skipped them. It waits 60s after the order's last state or error event so it never races the normal path.

**D-22 · Background work.** Locally (`next dev` / `next start`), `instrumentation.ts` runs `tick()` every 5s. On Vercel (`process.env.VERCEL` set), there is no in-process loop: webhooks are processed via `after()`, Vercel Cron calls `/api/cron/tick`, and an open order stream ticks while someone is watching. Same code, chosen by environment. That's "zero code changes".

**D-23 · Handover code storage.** HMAC (HKDF-derived key) for constant-time checking, plus AES-256-GCM ciphertext bound to the order id so the buyer's tracker can show the code again. Never sent to the vendor. 5 attempts, single use, 30-day expiry. Per-token and per-IP rate limits sit in front.

**D-24 · AI provider (owner).** The owner has no paid AI key. The AI client speaks the OpenAI-compatible chat API, so free providers (Google AI Studio's Gemini, Groq) work by setting `AI_BASE_URL` / `AI_MODEL` / `AI_API_KEY`. The deterministic fallback passes every golden test on its own; `AI_API_KEY` empty means fallback-only, and the UI says so.

**D-25 · Env additions to §3.5.** `AI_BASE_URL` (provider-agnostic AI), `DATABASE_URL_TEST` (integration tests), `ADMIN_TOKEN` (required when `DEMO_MODE=false`, or /admin would be open), `CRON_SECRET` (Vercel Cron), `LOG_LEVEL`. Fail-fast validation lists every problem at once.

**D-26 · Tests and the Kora test double.** Unit and integration suites run against `tests/kora-double`, a local HTTP server whose every response copies a shape from Kora's docs (snapshots in `docs/kora-snapshots`). It also behaves statefully: under/overpayment preferences, insufficient funds, 035 failing. The `sandbox` suite runs the same flows against the real Kora sandbox with the owner's key. The double is test-only, and a test asserts no app module imports it.

## Built during the UI phase

**D-27 · Invite tokens are HMAC(request, label).** ProcureAI has no WhatsApp/SMS sending, so a person shares vendor links. Tokens are a keyed MAC of (request id, vendor label), stored only as sha256 — unguessable and single-purpose like random tokens, but the server can show the link again (admin screen) without storing it.

**D-28 · Copy changes where the handoff's words would be untrue.** Stage 1 is paid when money is held (D-12), so the tracker says "Held. Paying the vendor's 30%." and the paid screen says "receives ₦378,000 now". Kora's one-time accounts are single-use, so the short state says "Send ₦60,000 more to **this** account" (a new account). "Sent to 14 vendors" becomes "Invited N vendors" with the real directory count. The quotes footnote drops "one-colour front print" (not part of the parsed spec).

**D-29 · "next <weekday>"** means the occurrence in the following Monday–Sunday week (said on Monday 5 Oct, "next tuesday" = 13 Oct; plain "Tuesday" = 6 Oct). Relative dates resolve against the request's creation date in Lagos time.

**D-30 · UI additions not in the handoff**, built in its visual language: vendor business-details form (RC, bank picker from Kora's basic list, account, email, consent checkbox); "Quote sent", "Another vendor was chosen", "You were chosen — waiting for payment" and "On hold" phone states; buyer name/email fields when not in demo mode; expired-account state; payout-failed/blocked/disputed blocks on the tracker; Kora panel pills "Kora API" / "Simulated identity" / "✕ Signature invalid" (admin only) next to "✓ Signature verified"; SIMULATED IDENTITY badge; admin console and reconciliation screen; sandbox demo strip (DEMO_MODE + test key only); OFFLINE banner.

**D-31 · Wrong handover code returns 200 `{ok:false}`.** It is an expected answer, not a failed request; browsers log 4xx fetches as console errors, and the brief requires none.

**D-32 · "Save as image"** is a server-rendered PNG (`/r/:signedId/image`, `next/og`) with Inter embedded — the renderer's default font has no ₦ glyph.

**D-33 · `npm run dev:offline`.** Runs the app against the Kora test double (which also delivers signed webhooks) so the UI can be exercised without keys. A red "OFFLINE · KORA TEST DOUBLE" banner is on every page; it is never presented as Kora.

**D-34 · Record stamp is conditional.** "ALL REFERENCES SIGNED BY KORA" only when every money movement was confirmed by a signature-verified webhook; otherwise "ALL REFERENCES CONFIRMED WITH KORA" (some were confirmed by query).

**D-35 · Home marketing page implemented.** `/` renders the high-fidelity Home marketing page recreated from `ProcureAI Home.dc.html` (interactive prompt parser into 4 chips, example buttons, buyer/vendor switch, animated Money Trail, Who it's for, Three steps, FAQs accordion, vendor value prop, and call-to-action buttons into `/buy?text=...`). `/buy` continues to serve as the direct purchase workflow starting point.

