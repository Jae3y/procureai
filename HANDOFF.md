# HANDOFF — read this first (for the next AI agent or developer)

Last updated: 6 Oct 2026, end of a Claude Code session. Repo: `github.com/Jae3y/procureai` (private, branch `main`).
The full original brief (phases P0–P8, invariants I1–I8, test matrix, deliverables) is the spec this repo implements;
its key rules are restated below. **Work through "What's left", in order.**

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
