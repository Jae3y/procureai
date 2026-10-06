# ProcureAI

Buy in bulk with one sentence. **The AI chooses; Kora makes the choice safe.**

A buyer types *"300 branded T-shirts, under ₦1.5m, delivered by 23 October"*. Vendors reply in their own words; ProcureAI turns
messy replies into comparable rows. **Kora** verifies every vendor is a real registered business **and** that its payout account
belongs to that business or one of its directors — unverified vendors can't be recommended or paid. The buyer approves once and
pays into a one-time Kora account; the money is **held**; the vendor gets **30%** when it's held and **70%** when the buyer's
6-digit handover code is entered at delivery. Every purchase ends in a shareable record carrying real Kora references.

Remove Kora and there is no product: Kora gates the recommendation (identity), holds the money (bank-transfer pay-in) and
releases it (payouts), and every state change is confirmed against Kora (webhooks + re-query).

> Handing over to another agent? Start with **[HANDOFF.md](HANDOFF.md)**.

## Quick start

Requirements: Node ≥ 20.11, Docker Desktop.

```bash
npm install
cp .env.example .env          # then fill in the Kora/AI keys (see below)
npm run db:up                 # Postgres 16 on localhost:5434 (+ a procureai_test database)
npx prisma migrate deploy && npx prisma generate
npm test                      # 222 unit + integration tests (real Postgres, Kora test double)
```

### Run it

| Command | What it does |
|---|---|
| `npm run dev:offline` | No keys needed. App + a **Kora test double** (replays Kora's documented responses and sends signed webhooks), demo data reset. A red **OFFLINE** banner is on every page. |
| `npm run dev` | The real thing: talks to the **Kora sandbox** with your test key. |
| `npm run demo:reset` | Prepares the demo scenario in < 1 s and prints the buyer, admin and vendor-phone URLs. |
| `npm run preflight` | Calls every Kora endpoint ProcureAI uses with your test key; prints PASS/FAIL/SKIPPED with latency. |
| `npm run test:sandbox` | The full purchase against the real Kora sandbox (skips loudly without a key). |

Open `http://localhost:3000/demo` (buyer), `/admin` (controls, events, reconciliation), and the vendor link on a phone.

### Keys (`.env`)

| Variable | Where from |
|---|---|
| `KORA_SECRET_KEY`, `KORA_PUBLIC_KEY` | Kora dashboard → **Test mode** → Settings → API Configuration (`sk_test_…`, `pk_test_…`) |
| `KORA_WEBHOOK_URL` | Your public HTTPS URL + `/api/webhooks/kora` (e.g. ngrok static domain). Paste the same URL into Kora dashboard → API Configuration → Webhook URL. |
| `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL` | Any OpenAI-compatible API. Free: Google AI Studio (Gemini) or Groq. Leave the key empty to use the rule-based parser (UI shows "read by rules"). |
| `DATABASE_URL`, `RECORD_SIGNING_SECRET`, `APP_BASE_URL` | Pre-filled for local use. |
| `DEMO_MODE`, `SIMULATE_IDENTITY`, `ENABLE_CHECKOUT_REDIRECT`, `ADMIN_TOKEN` | Flags. `ADMIN_TOKEN` is required when `DEMO_MODE=false`. |

The app validates the environment at boot and lists everything missing at once.

## Preflight (real Kora sandbox)

`npm run preflight` runs every critical Kora call with the test key in `.env` and prints a table. The last full run
against the real sandbox (owner's test key, 6 Oct 2026) is recorded response by response in
`tests/fixtures/kora/recorded/` and `lib/kora/fixtures/recorded/`:

| Check | Real sandbox answer |
|---|---|
| CAC valid (`00000011`, type `RC`) | 200 "CAC verified successfully" |
| CAC invalid (`11111111`) | 404 "CAC data not found" |
| Identity banks (basic) | 200 with `data: []` (empty in sandbox; see DECISIONS D-38) |
| Balance | 200 (`available_balance` in naira) |
| Payout 033/0000000000 (₦1,000) | 200 processing → query: success |
| Payout 035/0000000000 (₦1,000) | 200 processing → query: failed |
| Payout 011/9999999999 | 409 "Invalid account." |
| Payout to identity account 058/0123456789 | 409 "Invalid account." (DECISIONS D-36) |
| Payout below ₦1,000 | 409 "You can only transfer an amount between NGN 1000 and NGN 10000000" |
| Bank-transfer charge (≤ ₦1,000,000) | 200 processing; query: processing |
| Bank-transfer charge > ₦1,000,000 | 422 `amount must be less than or equal to 1000000` (DECISIONS D-37) |

Re-run it after any key or account change and paste the new table here. It can't run from a network that blocks
`api.korapay.com` (BLOCKERS B-08); it then reports every row as FAIL and records nothing.

## What's where

- **Product & money path**: `lib/domain/` (state machine, matching rule, pay-in, payouts, handover, refunds), `lib/kora/` (the only Kora client), `lib/webhooks/`, `lib/worker/` (outbox + reconciliation poller).
- **Invariants in the database**: `prisma/migrations/*_invariants/migration.sql` (I1–I8).
- **UI**: `app/` + `components/`, built from `ProcureAI design system/design_handoff_procureai/`.
- **Docs**: [VERIFIED_ENDPOINTS.md](VERIFIED_ENDPOINTS.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [DEMO.md](DEMO.md) · [DECISIONS.md](DECISIONS.md) · [BLOCKERS.md](BLOCKERS.md) · [KORA_FEEDBACK.md](KORA_FEEDBACK.md)

## Tests

| Suite | Command | What |
|---|---|---|
| Unit | `npm run test:unit` | matching table, money split (exhaustive), state machine, signature, Kora client retry/error policy, Zod rejection, AI golden tests |
| Integration | `npm run test:integration` | every invariant attacked through the DB, money path, webhooks (valid/tampered/duplicate/out-of-order/never-5xx), outbox backoff, concurrency races, property tests, the full headless flow |
| Sandbox | `npm run test:sandbox` | the same flow against the real Kora sandbox |

## Deploy

Runs on Vercel + hosted Postgres with no code changes: `instrumentation.ts` runs the background loop only on long-running
servers; on Vercel the same `tick()` is driven by `/api/cron/tick` (protected by `CRON_SECRET`), `after()` on webhook
receipt, and open SSE streams.

**What the code already does for a shared demo**
- `npm run vercel-build` (Vercel runs it instead of `build`) = `prisma generate && prisma migrate deploy && next build`, so
  every deploy applies the migrations, invariant triggers included.
- `vercel.json` schedules the cron **daily** (Vercel Hobby allows no more). The poller and self-heal want a tick every
  minute, so add a free external pinger (below). Webhooks and open pages still tick on their own.
- With `DEMO_MODE=true` **and** `ADMIN_TOKEN` set, the demo is safe to share: `/admin` and the global demo controls
  need the token; each visitor to `/buy` or `/demo` gets a buyer of their own (scripted vendors reply to every request);
  the sandbox "Transfer" buttons work on the visitor's own order only; the tracker links to the vendor's phone.
  Without `ADMIN_TOKEN`, `DEMO_MODE` is the single-presenter local demo (admin open to all).

**Owner steps (keys are entered by the owner only)**
1. vercel.com → sign in with GitHub → **Add New → Project** → import `Jae3y/procureai`.
2. **Storage → Create → Neon Postgres** (free) → connect it to the project (sets `DATABASE_URL`).
3. **Settings → Environment Variables**: `KORA_SECRET_KEY`, `KORA_PUBLIC_KEY`,
   `KORA_BASE_URL=https://api.korapay.com/merchant/api/v1`, `KORA_WEBHOOK_URL=https://<project>.vercel.app/api/webhooks/kora`,
   `APP_BASE_URL=https://<project>.vercel.app`, `RECORD_SIGNING_SECRET` (32+ random chars), `ADMIN_TOKEN` (24+ random
   chars), `CRON_SECRET` (random), `DEMO_MODE=true`, `SIMULATE_IDENTITY=false`, `ENABLE_CHECKOUT_REDIRECT=false`,
   `AI_API_KEY` / `AI_BASE_URL` / `AI_MODEL` (optional; empty = rule-based parser). → **Deploy**.
4. Kora dashboard → Settings → API Configuration → webhook URL = the same `KORA_WEBHOOK_URL`.
5. Seed the vendor directory once: locally, `DATABASE_URL=<Neon URL> npm run demo:reset`.
6. Free pinger: cron-job.org → new cron job → URL `https://<project>.vercel.app/api/cron/tick`, every minute,
   method GET, header `Authorization: Bearer <CRON_SECRET>`.
7. Check on the live URL: `/api/health`; a full purchase from `/buy` to the record page; the PNG at `/r/<id>/image`;
   a webhook arriving (admin page, after signing in with `ADMIN_TOKEN`); the pinger's job history showing 200s.
