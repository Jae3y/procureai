# HANDOFF — read this first (for the next AI agent or developer)

Last updated: 6 Oct 2026, end of a Claude Code session. Repo: `github.com/Jae3y/procureai` (private, branch `main`).
The full original brief (phases P0–P8, invariants I1–I8, test matrix, deliverables) is the spec this repo implements;
its key rules are restated below. **Work through "What's left", in order.**

---

## 0. START HERE — state at the local → cloud move (6 Oct 2026, evening)

The previous session (Claude Code, local Windows laptop) ran out of usage mid-task. This section is everything it knew
that isn't obvious from the code. Read it fully, then work through **0.3 in order**. Sections 1–10 below are older
background; where they disagree with §0, **§0 wins** (e.g. "222 passing" and "P1 BLOCKED" are stale).

### 0.1 What happened since §3 was written
- Another agent (Antigravity) ran the app against the **real Kora sandbox** with the owner's test key (commits
  `5a42cb4`, `8685d13`, `30513a4`, `3e2c981`). Real findings, all confirmed by real responses:
  - `POST /charges/bank-transfer`: **max ₦1,000,000 per one-time account** → HTTP 422
    `{"amount":{"message":"amount must be less than or equal to 1000000"}}`. ₦1,000,000 → 200.
  - `POST /transactions/disburse`: amount must be **₦1,000 – ₦10,000,000** (HTTP 409 otherwise).
  - Payout to the identity sandbox account 058/0123456789 → **"Invalid account."** So in live sandbox, payouts are routed
    to Kora's documented success account **033/0000000000** (`lib/domain/payouts.ts` `chooseRoute`, `kora().isLiveSandbox`),
    labelled `SANDBOX_TEST_ACCOUNT` in the DB and UI. Needs a DECISIONS entry (D-36).
  - CAC lookups need the **numeric id** (`00000011`, registration_type `RC`). An unknown RC → 404 "CAC data not found"
    (resolves BLOCKERS B-07; recorded in `lib/kora/fixtures/recorded/cac-RC11111111.json`).
  - `GET /identities/ng/banks?type=basic` returns **`data: []`** in sandbox (see 0.3 step 4).
  - Balances: `available_balance` is in **naira**, not kobo — the sandbox shows ≈ **₦4,999,520**. (The previous session
    once told the owner "₦49,995.20" — that was wrong; the schema parses it correctly.)
- **The other agent's commit `30513a4` faked money**: for orders over ₦1M it sent ₦1M to Kora and then *rewrote Kora's
  `amount_paid`/`amount_accepted` to a hard-coded 126_000_000n*. That breaks the brief ("credit only from Kora's
  re-queried amount", "no hard-coded success"). It has been **removed** from `lib/kora/client.ts` and replaced with
  honest **instalments**:
  - `lib/kora/limits.ts` (new): Kora's real limits + `instalmentsFor(totalKobo)`.
  - `lib/kora/client.ts`: `createBankTransferCharge` throws `RangeError` above ₦1M (never sends a doomed request);
    `queryCharge` returns Kora's answer untouched; sandbox credit validated against limits; new getter `isLiveSandbox`.
  - `lib/domain/payin.ts`: `openPayIn` asks Kora for at most ₦1M (unless `ENABLE_CHECKOUT_REDIRECT`). When an account is
    fully paid but the order still needs money, `afterCredit` logs "Transfer received" and opens the **next** account
    (`FollowUp` `NEXT_INSTALMENT`, `PayInKind` `"instalment"`, reference suffix `-P<n>`). It does **not** mark UNDERPAID —
    UNDERPAID is only for an account that was itself paid short.
  - `lib/worker/poller.ts` self-heal: AWAITING_PAYMENT + some money accepted + no open account → open the next instalment.
  - `lib/views/order-view.ts`: `pay.instalment = { part, of, receivedSoFar } | null`.
  - `components/order-flow.tsx`: pay screen shows "Transfer 1 of 2 · Pay into this account" plus a note explaining
    Kora's ₦1,000,000-per-account limit and how much has been received so far.
- `npx tsc --noEmit` is clean. **Tests: 216 pass, 5 fail** (listed in 0.3 step 1) — expected; they assert the old
  single-account behaviour.

### 0.2 The cloud environment (set up once)
- **Postgres**: no Docker in the cloud. `apt-get install -y postgresql && service postgresql start`, then create the role
  and databases from `.env.example` (`procureai` and `procureai_test`), or use a free Neon database. Then
  `npx prisma migrate deploy` (and for the test DB; see `scripts/test-db-reset.ts`).
- **Env vars**: the owner sets these in the cloud environment settings (never in chat, never committed):
  `KORA_SECRET_KEY`, `KORA_PUBLIC_KEY`, `RECORD_SIGNING_SECRET`, `AI_API_KEY` (+ `AI_BASE_URL`, `AI_MODEL`),
  `DATABASE_URL`/`DATABASE_URL_TEST`. The rest come from `.env.example`. Unit + integration tests need **no** Kora key
  (they use the Kora double in `tests/kora-double/`).
- Commit + push often; scan staged diffs for `sk_test_`, `sk_live_` and the signing secret before every commit.

### 0.3 What's left — in this order
1. **Fix the 5 failing tests by updating them to the honest instalment behaviour** (don't weaken the code):
   - `tests/unit/kora-client.test.ts` "converts Kora's string and number money fields" → use ₦1,000,000
     (`100_000_000n`, wire `1000000`); add a case: above ₦1M rejects with `RangeError` and makes **no** Kora call.
   - `tests/integration/money-path.test.ts`: `approvedOrder()` defaults to ₦1,260,000, which now opens a ₦1M account.
     Single-account tests ("opens a one-time account", "credits amount_accepted… underpayment", "'return all'
     preference", and every test doing `double.pay(payIn.reference, 126_000_000n)`) should use an order **≤ ₦1M**
     (e.g. ₦840,000) with expected numbers recomputed. **Some of those tests still pass today only because the double
     accepts ₦1.26m into a ₦1M account** — fix them too.
   - `tests/integration/flow.test.ts` (P4 headless flow) expects `pay.amountDue "₦1,260,000"` → now ₦1,000,000 then a
     second account for ₦260,000. Drive both transfers, so instalments are covered end to end.
2. **Kora double parity** (`tests/kora-double/server.ts`): `POST /charges/bank-transfer` with amount > 1000000 → 422 with
   the real body above; make over-payment into an account behave like Kora's documented over/underpayment guide.
3. **New integration test**: ₦1,260,000 order → `PA-<id>` ₦1,000,000 → pay → no UNDERPAID, event "Transfer received",
   second account `PA-<id>-P2` ₦260,000 → pay → HELD → Stage 1. Ledger total = ₦1,260,000; `expectMoneyInvariants`.
   Also: the poller self-heal opens the next instalment when the follow-up was lost.
4. **Empty basic bank list in sandbox**: `verifyBankAccountBasic` pre-validates the bank code against
   `identities/ng/banks?type=basic`, which is `[]` in sandbox, so every code is rejected in live sandbox and the vendor
   bank picker shows "Bank list unavailable". Fix: if Kora returns an empty list, skip the pre-check (log it) and fall
   back to the payout list (`misc/banks`) or the documented list for the picker, **labelled** as a fallback. Tests.
5. **Docs**: DECISIONS D-36 (live-sandbox payouts → 033, evidence "Invalid account.") and D-37 (instalments because of
   the ₦1M cap; why not the checkout redirect); BLOCKERS (B-07 resolved; B-01/B-03 updated with what the real key
   proved); KORA_FEEDBACK (₦1M cap missing from the bank-transfer guide; empty basic bank list in sandbox; identity and
   payout sandbox accounts disjoint; numeric CAC id); README preflight table from a real `npm run preflight`; §3 here.
6. **All green**: `npm run verify:banned`, `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`,
   `npm run verify:bundle`; Playwright e2e (the happy path pays ₦1.26m — now 2 transfers). Commit + push.
7. **Deploy to Vercel so judges can use it like a real website** (the owner's top priority):
   - Code (agent): build applies migrations (`"vercel-build": "prisma generate && prisma migrate deploy && next build"`);
     `vercel.json` has a per-minute cron, which **Vercel Hobby rejects** (Hobby allows daily) — make it daily and document
     a free external pinger (e.g. cron-job.org every minute → `/api/cron/tick` with `CRON_SECRET`; check what the route
     expects); require `ADMIN_TOKEN` for `/admin` whenever it is set, even with `DEMO_MODE=true`, so judges can't reset the
     shared demo; make sure each judge can run their own purchase from `/buy` (scripted vendor replies in demo mode) and
     the tracker shows a visible "Open vendor's phone" link in demo mode; seed the vendor directory on the production DB
     (`npm run demo:reset` with the production `DATABASE_URL`).
   - Owner (they must do these personally — never enter keys for them): vercel.com → sign in with GitHub → Add New
     Project → import `Jae3y/procureai`; Storage → create **Neon Postgres** (free) and connect it (sets `DATABASE_URL`);
     Settings → Environment Variables: `KORA_SECRET_KEY`, `KORA_PUBLIC_KEY`,
     `KORA_BASE_URL=https://api.korapay.com/merchant/api/v1`, `KORA_WEBHOOK_URL=https://<project>.vercel.app/api/webhooks/kora`,
     `APP_BASE_URL=https://<project>.vercel.app`, `RECORD_SIGNING_SECRET` (new random 32+ chars), `DEMO_MODE=true`,
     `SIMULATE_IDENTITY=false`, `ENABLE_CHECKOUT_REDIRECT=false`, `ADMIN_TOKEN`, `CRON_SECRET`, `AI_API_KEY`,
     `AI_BASE_URL`, `AI_MODEL` → Deploy. Then set the same webhook URL in the Kora dashboard.
   - Verify on the live URL: `/api/health`, a full purchase from `/buy` to the record page, the PNG at `/r/<id>/image`,
     a webhook arriving (admin page), the cron tick.

### 0.3a Progress — cloud session, 6 Oct 2026 (late)
Steps 1–6 are **done**, and step 7's code part is done. Branch `main-0lkoc1` (draft PR into `main`).
- Step 1–3: tests updated to the instalment behaviour; Kora double returns the real 422 above ₦1M and reverses an
  overpayment under "Return all"; new instalment tests (₦1.26m in 2 transfers, ₦2.5m in 3, short instalment = real
  underpayment, poller self-heal opens the lost next account). `charge.overpaid` event added for "Return all".
- Step 4: empty basic bank list handled (pre-check skipped; picker falls back to `/misc/banks`, labelled). **Found:**
  `/misc/banks` needs the **public** key (KORA_FEEDBACK §11) and the client sent the secret key — fixed (`auth: "public"`).
- Step 5: DECISIONS D-36–D-39, BLOCKERS (B-01/02/03/07 resolved; new B-08), KORA_FEEDBACK §12, README preflight table
  (from the recorded real responses) and deploy section.
- Step 6: `tsc`, `lint`, `verify:banned`, **237 tests**, `build`, `verify:bundle`, Playwright **2/2** (happy path now
  pays "Transfer 1 of 2" then ₦260,000) — all green.
- Step 7 (code): `vercel-build` applies migrations; cron daily + external pinger documented; shared-demo rules (D-39):
  admin needs `ADMIN_TOKEN` when set, a buyer per visitor, buyer-scoped sandbox buttons, "Open vendor's phone" link.
- Also fixed: preflight counted a proxy 403 as PASS on "invalid account" and overwrote recorded fixtures with proxy
  pages; now only Kora's own JSON answers count or get recorded.
- Audit round (same day): browser walk-through of every screen at 1440px and 390px (no console errors, no sideways
  scroll). Fixed: "underpaid"/"overpaid" repeated on every poll under "Return all"; short-payment screen on orders over
  ₦1M asked for more than one account takes; missing favicon (console 404); public `/api/health` leaked balance and DB
  errors (now admin-only details); `db:test:reset` used a flag Prisma 7 removed; npm audit 0 via overrides; DEMO.md
  numbers. Tests: **239**. Note: Prisma refuses `migrate reset` when an AI agent runs it, so run `db:test:reset` yourself.
- **Left for the owner:** README "Deploy → Owner steps" 1–7 (Vercel project, Neon, env vars, Kora webhook URL, seed,
  pinger, live checks), then a fresh `npm run preflight` from a network that can reach Kora (the cloud container can't,
  BLOCKERS B-08).

### 0.4 Owner context
- Owner: Jackson (GitHub `Jae3y`). Judges will **use the deployed site themselves**.
- No money for paid AI — keep the free OpenAI-compatible provider + deterministic fallback.
- Ask the owner for keys and real decisions; don't guess. Give them exact clicks for anything only they can do.
- Never fake a Kora response or amount. If Kora can't do something, plan around it honestly and label it.

---

## 1. What ProcureAI is (one paragraph)
A buyer types one sentence ("300 branded T-shirts, under ₦1.5m, delivered by 23 October"). Vendors reply in free text;
an AI layer (with a deterministic fallback) turns replies into comparable rows. **Kora** verifies each vendor (CAC +
bank-account name match → VERIFIED/FAILED); unverified vendors can't be recommended or paid. The buyer approves, pays into
a one-time Kora bank-transfer account; money is HELD; vendor gets 30% (Stage 1) when held and 70% (Stage 2) when the
buyer's 6-digit handover code is entered. Every purchase ends in a shareable record with Kora references.

## 2. Owner preferences (important)
- **Ask the owner** for keys/decisions instead of guessing. Secrets go in `.env` (git-ignored) — never ask them to paste keys into chat, never commit them.
- Owner has **no paid AI key** → AI is OpenAI-compatible (free Gemini AI Studio or Groq via `AI_BASE_URL`/`AI_MODEL`/`AI_API_KEY`); deterministic fallback must keep working.
- **Commit + push to `main` at each milestone** (scan staged diff for `sk_test_`/`sk_live_` and the `RECORD_SIGNING_SECRET` value first).
- Webhooks via an **ngrok static domain** (owner is setting it up). Postgres in **Docker on host port 5434** (5432 = local service, 5433 = owner's other project "aether" — don't touch it).

## 3. Status by phase (gates from the brief)
| Phase | State | Notes |
|---|---|---|
| P0 Endpoint discovery | ✅ PASS | `VERIFIED_ENDPOINTS.md`, raw doc snapshots in `docs/kora-snapshots/` (incl. full Postman collection) |
| P1 Preflight | ⏳ BLOCKED on owner's Kora test key | `npm run preflight` works; real Kora reachability verified (401 w/o key). All key checks SKIPPED until `KORA_SECRET_KEY=sk_test_…` is in `.env` |
| P2 Schema/invariants | ✅ PASS | 31 DB-level invariant attack tests + matching table + money split + state machine |
| P3 Kora client/webhooks/outbox/poller | ✅ PASS except "real captured payload" (needs key + ngrok → `npm run capture:webhook-fixture`) |
| P4 Full flow headless | ✅ vs Kora double (`tests/integration/flow.test.ts`); ⏳ real sandbox `tests/sandbox/flow.test.ts` (4 tests, auto-skip without key) |
| P5 AI + golden tests | ✅ deterministic + scripted-model tests (`tests/unit/ai-golden.test.ts`); real model pending a free key |
| P6 UI | ✅ clicked end-to-end in browser (`npm run dev:offline`): request→quotes→decision→pay (incl. underpay)→tracker→vendor phone code→paid→record (+PNG). No console errors except dev-only SSE resets during hot reload |
| P7 Failure states/admin/demo controls | ✅ PASS | All §15 failure states reproducible on demand via `/admin` + `dev:offline`; click paths documented in `DEMO.md` |
| P8 Docs/seed/Playwright/final review | ✅ PASS | Full documentation deliverables complete, Playwright e2e passing (happy path + home page specs), ESLint flat config with zero errors, Next production build and verify:bundle passing cleanly |

Tests: `npm test` → **222 passing** (unit + integration, real Postgres test DB + Kora double). E2E: `npm run test:e2e` → **2 passed** (Playwright chromium headless).

## 4. How to run
```bash
npm install
npm run db:up                 # docker compose Postgres on localhost:5434 (dbs: procureai, procureai_test)
npx prisma migrate deploy && npx prisma generate
npm test                      # unit + integration (needs Docker DB)
npm run test:e2e              # Playwright browser end-to-end suite (against offline double)
npm run lint                  # ESLint 9 + typescript-eslint flat config (no explicit any, no empty catch)
npm run typecheck             # tsc --noEmit
npm run build                 # production Next.js build
npm run verify:bundle         # scans client bundle for leaked secrets
npm run dev:offline           # app + Kora TEST DOUBLE on :4010, demo data reset, red "OFFLINE" banner
npm run dev                   # real Kora sandbox — needs KORA_SECRET_KEY/KORA_PUBLIC_KEY/KORA_WEBHOOK_URL in .env
npm run demo:reset            # prepares the §12 demo scenario (<1s); prints buyer/admin/vendor-B URLs
npm run preflight             # real Kora checks with the owner's test key → paste table into README
npm run test:sandbox          # real-sandbox flow tests (skip loudly without key)
npm run verify:banned         # no TODO/FIXME/any/empty catch/Kora calls outside lib/kora
```
Demo URLs: `/demo` (signs in demo buyer, opens current request), `/admin`, `/admin/reconcile`, vendor link printed by demo:reset.
If Docker Desktop is down: start it (`Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"`), then `npm run db:up`.

## 5. Architecture map (where things live)
- `lib/kora/` — **the only code that talks to Kora**. `client.ts` (typed methods, 10s timeout, retries only on network/5xx for safe calls, **never** retries disburse/sandbox-credit/refund), `errors.ts` (typed hierarchy, `outcomeKnown`), `schemas.ts` (Zod; money = number|string → bigint kobo), `signature.ts` (HMAC over raw `data` byte span + Kora's re-serialised form), `body.ts` (exact decimal amounts), `simulated-identity.ts` + `fixtures/` (SIMULATE_IDENTITY).
- `lib/domain/` — `state.ts` (state machine table + `transition()` + `lockOrder()` FOR UPDATE), `matching.ts` (THE matching rule), `payin.ts` (truthful amounts: credit only from re-queried `amount_accepted`), `payouts.ts` (row-first then Kora; unknown outcome stays PENDING), `handover.ts`, `refunds.ts`, `verification.ts`, `recommend.ts`, `approve.ts`, `requests.ts`, `vendors.ts`, `timeline.ts`, `settings.ts` (demo toggles).
- `lib/ai/` — `client.ts` (OpenAI-compatible), `extract.ts`/`normalize.ts`/`rank.ts` (AI + server-side fences), `fallback.ts` (deterministic parsers), `numbers.ts`, `dates.ts`, `prompts.ts`.
- `lib/webhooks/receive.ts` (store-then-process), `lib/worker/` (outbox w/ SKIP LOCKED + backoff, poller + self-heal, tick loop), `lib/realtime/listener.ts` (pg LISTEN), `lib/http/` (route wrapper, idempotency keys, rate limits, sessions, SSE).
- `lib/views/` — server-side view models (all money pre-formatted; client does no money maths).
- `prisma/migrations/*_invariants` — raw SQL for I1–I8 triggers/CHECKs/partial index. **Don't let `prisma migrate dev` drop them** (it hasn't so far; check generated SQL).
- `app/` — pages (`/` Home marketing page, `/buy`, `/buy/[requestId]`, `/orders/[orderId]`, `/r/[signedId]` (+`/image` PNG), `/v/[token]`, `/admin`, `/admin/reconcile`, `/demo`) and API routes per brief §9.
- `components/` — `ui.tsx` (Header, KoraPanel, MoneyTrail), `hooks.ts` (useLive SSE, useAction w/ Idempotency-Key, useCountdown), screen components, `home-page.tsx`.
- `tests/` — `unit/`, `integration/` (real DB), `sandbox/` (real Kora), `kora-double/` (test-only fake Kora; never import from app code), `helpers/`, `e2e/` (Playwright browser tests).
- Design handoff: `ProcureAI design system/design_handoff_procureai/` (README + `.dc.html` prototypes). UI follows it; additions listed in DECISIONS.md.

## 6. What's left — do in this order
1. **P7 pass**: ✅ Reproduced each §15 failure state on demand via `/admin` + `dev:offline`. Click paths documented in DEMO.md.
2. **Docs (P8, required deliverables)**: ✅ `README.md`, `ARCHITECTURE.md`, `DEMO.md`, `KORA_FEEDBACK.md`, updated `DECISIONS.md` (D-01 through D-35), `BLOCKERS.md`.
3. **Playwright e2e**: ✅ `playwright.config.ts` configured with `webServer: npm run dev:offline`; Chromium installed; `happy-path.spec.ts` (verifies full purchase, buyer code, money trail, accounting ₦0, and asserts unverified Vendor A cannot be approved) + `home-page.spec.ts` (verifies Home marketing page, buy/sell toggle, prompt parsing into chips, and continuing into app) both passing.
4. **UI additions**: ✅ Home marketing page (`/`) created from `ProcureAI Home.dc.html` with interactive parsing into chips, example prompts, vendor preview, and direct transition to `/buy?text=...`.
5. **ESLint config**: ✅ `eslint.config.js` added using ESLint 9 + `typescript-eslint` flat config (banning explicit `any`, empty catch blocks, unused vars). `npm run lint` passes with 0 errors.
6. **Production build & verification**: ✅ `next build` passes in 51s; `npm run verify:bundle` passes scanning all client files with 0 secret leaks; `npm run verify:banned` passes clean.
7. **When the owner's keys arrive**: `npm run preflight` → paste output into README; `npm run test:sandbox`; set `KORA_WEBHOOK_URL` to the ngrok URL + same URL in Kora dashboard; `npm run capture:webhook-fixture`; record any real Kora behaviour that differs into BLOCKERS/KORA_FEEDBACK.

## 7. Non-negotiables (from the brief) — keep them true
- Money = BIGINT kobo; no floats server-side (an integration test scans `lib/` and `app/` for float-money patterns).
- Every order status change goes through `transition()` (DB trigger requires a same-transaction audit row).
- Payout row (unique reference) is written in the same tx as the state change, **then** Kora is called; unknown outcome → PENDING → poller; retry only after confirmed FAILED, with a new reference + `retryOfId`.
- Charges are credited only from re-queried Kora amounts (`amount_accepted` ?? `amount_paid`), never the webhook amount.
- Webhook route always returns 200; persists invalid signatures; dedupes on (type, reference, hash).
- No Kora calls outside `lib/kora`; no `any`; no empty catch; no TODO/FIXME in the deliverable (`npm run verify:banned`).
- Never simulate silently: SIMULATE_IDENTITY shows a badge; offline mode shows a banner; sandbox payout route is labelled.

## 8. KORA_FEEDBACK material collected so far (write it up properly)
- CAC: guide table omits `registration_type` but both examples send it; Postman marks it required with `id` "00000011" vs guide "RC00000011".
- Money fields switch between JSON numbers and decimal strings across endpoints/examples.
- Bank-transfer guide gives body but not the path (only links to Postman); says API must be enabled by support; sandbox auto-completes after 2 minutes unless `auto_complete:false`.
- Query Charge success example omits `amount_accepted`, which the under/overpayment guide says to use.
- Balance history: two different documented response shapes (`data.history[]` + `date` vs top-level `has_more` + `data{}` + `date_created`).
- Webhook signing sample re-serialises (`JSON.stringify(req.body.data)`), fragile vs raw bytes; no timestamp/replay protection; event name not covered by signature.
- Metadata keys disallow `_` (so `order_id` from the brief is illegal) — easy to miss.
- Identity sandbox data (058/0123456789) and payout sandbox accounts (033/035/011) are disjoint; no documented error body for invalid CAC.
- No `identity.*` webhooks (design handoff assumed some).
- Three separate bank-code lists (identity basic, identity premium, payout `misc/banks`).

## 9. Gotchas
- On Windows, editing files with Python `open(...,"w")` writes CRLF; repo is LF (`.gitattributes`). Prefer the editor tool or `newline="\n"`.
- A security hook ("Sage") blocks writing files containing the literal phrase "ignore previous instructions"; tests assemble it from parts.
- Dev mode first-hit compile can take ~10 s per route — not an app bug.
- Docker Desktop restarts can briefly drop the DB/network (a run of DB-connection failures → just re-run).
- Kora sandbox `pay` in dev: use admin "Pay the account (sandbox)" or the sandbox strip on the pay screen (real `POST /virtual-bank-account/sandbox/credit` with a test key).

## 10. Working across machines (local ⇄ cloud ⇄ Antigravity) — read before starting

**GitHub `main` is the single source of truth.** Nothing syncs by itself: every tool (Claude Code local, Claude Code cloud,
Antigravity) works on its own copy and only meets the others through GitHub.

**The one rule that prevents conflicts: only one agent works at a time.**
1. Before you start: `git pull origin main` (or, in a cloud session, start from the latest `main`).
2. While working: commit + push small and often.
3. When you stop: commit + push everything. Check `git status` is clean.
4. The next agent starts at step 1.

**Cloud sessions (claude.ai/code):**
- Open claude.ai/code → choose repo `Jae3y/procureai` → first message: "Read HANDOFF.md and continue from §6".
- Cloud sessions usually push to their own branch (e.g. `claude/…`) and may open a pull request. To bring that work back:
  merge the PR on GitHub (or `git merge origin/<branch>` locally), then on the laptop: `git checkout main && git pull`.
- No Docker there: install Postgres in the session (`apt-get install -y postgresql` + create `procureai`/`procureai_test`) or use a free hosted Postgres (Neon/Supabase) and set `DATABASE_URL` / `DATABASE_URL_TEST`.
- Secrets: set `KORA_SECRET_KEY`, `KORA_PUBLIC_KEY`, `AI_API_KEY`, `RECORD_SIGNING_SECRET` as environment variables in the cloud environment settings. `.env` is never in git.
- Kora can't reach a cloud session for webhooks; the poller and Re-check still complete every payment.

**Antigravity (local):** open the folder `C:\Users\HP\Documents\jaeys-projects\procureai`, run `git pull origin main` first,
point it at this file. Start Docker Desktop, then `npm run db:up`.

**If git ever reports a conflict:** stop, don't force-push. `git status` shows the files; keep both changes where they're
independent, run `npm test`, commit. Never use `git push --force` on `main`.
