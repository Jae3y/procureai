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

Run `npm run preflight` and paste the table here. Current state (no test key configured yet):

```
| Kora reachable (no key → expect 401)  | PASS    | 401 | {"status":false,"error":"not_authenticated","message":"no authorization token found"} |
| CAC valid / invalid, banks, account,  | SKIPPED | -   | KORA_SECRET_KEY is not set in .env                                                    |
|   balance, payouts 033/035/011/058,   |         |     |                                                                                       |
|   bank-transfer charge, query charge  |         |     |                                                                                       |
Identity status: UNKNOWN — KORA_SECRET_KEY is not set in .env.
```

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
servers; on Vercel the same `tick()` is driven by Vercel Cron (`vercel.json` → `/api/cron/tick`, protected by `CRON_SECRET`),
`after()` on webhook receipt, and open SSE streams.
