# ProcureAI

**Buy in bulk with one sentence. The AI chooses; Kora makes the choice safe.**

**Try it live → [procureai-six.vercel.app/buy](https://procureai-six.vercel.app/buy)** (runs on Kora's sandbox, so every naira is test money)

> *"300 branded T-shirts, under ₦1.5m, delivered by 23 October."*

That one sentence is the whole interface. ProcureAI asks vendors for quotes, reads their messy replies into one comparable
table, checks every vendor with Kora, recommends one, takes the payment, holds the money, and pays the vendor only as the
goods arrive. It ends in a record anyone can verify.

## The problem

Bulk buying in Nigeria runs on WhatsApp voice notes, "send half now", and trust. A buyer compares prices that arrive in
different shapes, pays a stranger up front, and has no proof afterwards. The cheapest quote is often the one that isn't real.

## What happens

| | Step | What the buyer sees |
|---|---|---|
| 1 | **Ask** | One sentence. Vendors reply in their own words; ProcureAI turns "boss good evening, 300 pcs i go do am 3900 per one" into a clean row. Totals are computed in code, never by the model. |
| 2 | **Check** | Kora confirms each vendor is a registered business **and** that the payout account belongs to that business or one of its directors. A vendor that fails is struck through with Kora's reason, and cannot be approved or paid. |
| 3 | **Approve** | One click. Kora opens a one-time bank account for this purchase only. |
| 4 | **Pay** | The buyer transfers from any bank app. ProcureAI re-asks Kora how much actually arrived before crediting a single kobo. Kora caps one account at ₦1,000,000, so a ₦1.26m order is paid as two honest transfers. |
| 5 | **Hold** | The money sits held. 30% goes to the vendor now, so they can start work. |
| 6 | **Deliver** | The buyer gets a 6-digit code. The vendor types it on delivery and the remaining 70% is released. |
| 7 | **Record** | A shareable page lists every naira in and out with its Kora reference, and ends on **Left unaccounted: ₦0**. It saves as an image. |

## Why Kora is the product, not a plug-in

Take Kora out and ProcureAI stops existing: Kora **gates** the recommendation (identity), **holds** the money (one-time
bank-transfer accounts) and **releases** it (payouts). Every state change is confirmed against Kora twice, by signed
webhook and by asking Kora directly.

| Kora capability | Used for |
|---|---|
| CAC business verification | Is this vendor a real, active registered company? |
| Bank account verification | Does the payout account belong to the company or a director? (name matching rule below) |
| Bank-transfer charges + charge query | The one-time pay-in account, and the truth about what was paid |
| Payouts + payout query | Stage 1 (30%) and Stage 2 (70%) to the vendor, each with its own reference |
| Balances and balance history | Pre-flight funds check, and a reconciliation screen that matches Kora's ledger to ours |
| Webhooks | Signed events, verified over the raw bytes, stored first, processed after |
| Refunds | Overpayments and reversals |

The sandbox-verified behaviour of each endpoint, including the parts Kora's docs don't mention, is in
[VERIFIED_ENDPOINTS.md](VERIFIED_ENDPOINTS.md) and [KORA_FEEDBACK.md](KORA_FEEDBACK.md).

## Built to be trusted with money

- **Rules live in the database, not just the code.** Eight invariants are enforced by Postgres triggers and constraints:
  an order can't be paid without a verified vendor, the ledger can't go out of balance, a payout can't exceed what is held.
  Tests attack each one by writing straight to the tables to try to break it.
- **Truthful amounts.** The buyer is credited only from Kora's re-queried figure, never from a webhook body.
- **Money is exact.** Integer kobo end to end; there is no floating-point money anywhere on the server.
- **Safe when things go wrong.** Duplicate, out-of-order, forged and missing webhooks; Kora timeouts; unknown payout
  outcomes; double-clicks and races. Each has a defined behaviour and a test, and all of them can be triggered on
  demand from the admin page.
- **The AI is fenced.** A model reads messy text, but every number it returns must appear in the vendor's message, the
  ranker never sees vendor free text, and a deterministic parser takes over if the model is down.
- **Nothing is silently simulated.** Any simulated path shows a visible badge.

**243 automated tests** (unit, integration against a real Postgres, and Playwright end to end), plus a suite that runs the
full purchase against the real Kora sandbox.

## See it in 90 seconds

1. Open **[/buy](https://procureai-six.vercel.app/buy)**, press Continue, then **Ask vendors**. Three vendors reply.
2. **Check vendors with Kora.** One is struck through. The cheapest vendor isn't a registered business.
3. **Approve**, then use the sandbox strip to make the transfer(s).
4. **Open tracker**, then **Open vendor's phone**, and type the buyer's 6-digit code.
5. **Open record.** Every reference, and ₦0 unaccounted.

The click-by-click script, with every failure state you can trigger on demand, is in [DEMO.md](DEMO.md).

## How it's built

Next.js (App Router, TypeScript strict) · Postgres + Prisma · Zod on every boundary · server-sent events for live
screens · Vercel-ready. One module, `lib/kora/`, is the only code that talks to Kora.
Read [ARCHITECTURE.md](ARCHITECTURE.md) for the state machine, the webhook path and the concurrency rules, and
[DECISIONS.md](DECISIONS.md) for why each non-obvious choice was made.

To run it yourself, including offline with no keys: [docs/SETUP.md](docs/SETUP.md).
