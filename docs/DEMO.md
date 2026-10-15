# Demo — the 90-second script

Setup (once, before recording): `npm run db:up`, then `npm run dev` (real Kora sandbox, test key in `.env`) **or**
`npm run dev:offline` (no keys; red OFFLINE banner visible). Run `npm run demo:reset` before every take — it takes < 1 s
and prints three URLs:

- **Laptop** (1920×1080): `http://localhost:3000/demo`
- **Phone** (390 wide): the "Vendor B (phone)" URL
- **Admin** (second tab): `http://localhost:3000/admin`

## The 90 seconds

| t | Click | What appears | Say |
|---|---|---|---|
| 0:00 | open `/demo` | **Quotes** — replies arrive one by one from the vendors ProcureAI shortlisted (some decline, one never answers). Each messy reply on the left resolves into a clean row: Mama Tobi Trading ₦3,900, Kwik Supplies ₦4,200, Imole Wholesale ₦4,500 | "Three vendors replied however they like. ProcureAI reads them into one format — totals are computed in code, never by the model." |
| 0:12 | **Check vendors with Kora →** | **Decision** — "Checking with Kora…", then Vendor A struck through in red: *✕ Company registration could not be verified* (RC11111111); Vendor B green: *Registered as John Doe Inc RC00000011 · Status: Active · Payout account belongs to a registered director* + KORA stamp | "Kora checks the company and who owns the payout account. The cheapest vendor isn't registered, so ProcureAI won't send it money." |
| 0:25 | **Approve Vendor B** | **Pay** — one-time account number (Kora `POST /charges/bank-transfer`), bank, account name, live countdown | "One account, for this purchase only." |
| 0:32 | Sandbox strip → **Transfer ₦1,000,000**, then, when the next account appears, **Transfer ₦260,000** (or admin → *Pay the account* twice) | "Transfer 1 of 2" with a note: Kora takes up to ₦1,000,000 per account. After the second transfer: "Payment confirmed" stamp with `KORA · PA-…` reference | "Kora tells us by signed webhook — and we re-ask Kora how much actually arrived before we credit a kobo." |
| 0:40 | **Open tracker →** | Money Trail: Paid ✓ → Held (amber) → Stage 1 ✓ `PO-…-S1`; Kora events panel with ✓ Signature verified pills; delivery code e.g. **757 573** | "Money is held. 30% already went to the vendor. The line only moves when Kora confirms." |
| 0:55 | Phone: type the code → **Confirm delivery** | Phone: "₦882,000 is on its way" → full-green **Paid** screen. Laptop (live, no refresh): "Complete. Every naira accounted for." Held ₦0 | "The vendor gets the rest only with the buyer's code." |
| 1:10 | **Open record →** | Record: request, quotes (A struck), why B, Kora checks with references, every naira in and out with its Kora reference, **Left unaccounted ₦0**, stamp *COMPLETE · ALL REFERENCES SIGNED BY KORA*. **Save as image** downloads a PNG | "Every purchase ends in a record anyone can check." |
| 1:20 | Admin → **Reconciliation** | Kora's own balance history next to ProcureAI's ledger, matched by reference | "And this is how we prove it to an engineer." |

## Failure states on demand (all from `/admin` unless noted)

Reset with `npm run demo:reset` between scenarios.

| §15 case | How to show it | What you see |
|---|---|---|
| Verification failed with reason | Default scenario | Vendor A struck, reason verbatim, can't be approved (API answers 409) |
| Underpayment with shortfall | Pay screen strip → **Transfer ₦60,000 less** (or admin *Force underpayment*) | "₦320,000 short." in red, ₦940,000 held (amber), a new account for ₦320,000. On orders above ₦1,000,000 the screen asks only for what the open account takes (Kora's per-account cap) |
| Overpayment accepted | Kora dashboard over/underpayment preference = *Accept all*, pay more than due | Tracker + record show the excess "held for refund"; vendor paid exactly the total |
| Payout failed with retry | Before paying: admin **Force payout failure (035)**; pay | Stage 1 node red "Stage 1 failed", `PO-…-S1 · Failed`, **Retry payout** → admin **Pay the verified account** first → new reference `PO-…-S1-R2` succeeds |
| Unfunded disbursement balance | Real sandbox with low balance, or offline double balance 0 | "Insufficient funds in disbursement wallet. Kora balance is ₦X; Stage 1 needs ₦378,000." No payout written |
| Missing webhook → poller / Re-check | Admin **Suppress the next webhook**, then pay | Order stays waiting; timeline "Webhook suppressed (demo)"; ~20 s later the poller (or **I've sent it** / **Re-check with Kora**) completes it |
| Invalid webhook signature | Admin events table → **Corrupt signature** on a charge event | New red row "✕ Invalid"; nothing changes |
| Duplicate webhook | Admin → **Replay** | "Recognised as a duplicate, nothing changed"; info row "Duplicate webhook ignored" |
| Wrong / expired code with attempts remaining | Phone: enter a wrong code | "That code isn't right. 4 attempts left."; after 5: locked |
| AI timeout → fallback parse | Set `AI_API_KEY` to a provider that times out (or no key) | Quote rows tagged "rules"; recommendation "Ranked by ProcureAI's rules" |
| Kora 5xx / timeout readable | Offline: double overrides; real: unplug network during approve | "Kora didn't answer in time. Nothing is lost; we'll confirm the result with Kora." Payout stays pending until Kora answers |
| Identity access blocked → labelled simulation | `SIMULATE_IDENTITY=true` in `.env`, restart | **SIMULATED IDENTITY** badge on the decision screen and the record |

## Delivery without the code, and disputes

The code is the fast path, not the only key. Once Stage 1 has landed:

| Case | How to show it | What you see |
|---|---|---|
| Buyer never hands over the code | Vendor phone → **Delivered, but no code from the buyer?** → note + photo → **Mark as delivered** | Buyer's tracker: "Kwik Supplies says it's delivered" with the photo and the date Stage 2 releases (72 h later, `DELIVERY_GRACE_HOURS`). In a pitch: admin Orders → **Skip the wait (demo)** → Stage 2 releases → Complete |
| Buyer reports a problem in time | Tracker → **Something's wrong** → note + photo → **Freeze payouts** | Payouts frozen; the timer stops. The vendor's phone shows "This order is on hold" and both sides' evidence; the vendor adds theirs with **Send my side** |
| Admin settles it | Admin Orders → the DISPUTED row → **Evidence** to read both sides → **Pay vendor** or **Refund buyer** | Pay vendor: Stage 2 releases exactly as if the code had been entered. Refund buyer: what is still held goes back through Kora. Once a refund is under way, Pay vendor is refused |
| Report after the window | The window has passed | "The time to report a problem with this delivery has ended." |

## Registered vendors (the main way vendors quote)

- A vendor registers once at **/vendors/join** (landing page → For vendors → *Register your business*): business name, phone, what they sell, city, CAC number, bank account, email. They join the directory that sourcing searches. A profile can't be overwritten from that form.
- When invited, a registered vendor's link shows **"Sending as your registered business"** and asks only for the reply. In the T-shirt demo, Onitsha Textile Mart (registered, never replies by itself) shows this: open its link from admin → Vendor links.
- A vendor who isn't registered still gets the full one-off form (business details typed in), with a link to register. Kora verifies every vendor on every purchase either way.

## Fallback path (if something misbehaves live)

1. Identity call fails on stage → set `SIMULATE_IDENTITY=true`, restart, `npm run demo:reset` (badge makes it explicit).
2. Webhook doesn't arrive (tunnel down) → press **I've sent it** / **Re-check with Kora**; the poller also finishes it within ~20 s.
3. Sandbox payout stuck → admin **Run poller now**; if Kora sandbox rejects the verified account, admin **Use Kora's 033 success account** (labelled on the record).
4. Everything off → `npm run dev:offline` runs the identical flow against the test double with the OFFLINE banner.
