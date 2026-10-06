# Handoff: ProcureAI

## Overview
ProcureAI is a web app for Nigerians who buy in bulk with pooled money (event organisers, class reps, shop owners). The buyer types one sentence. An AI agent collects vendor quotes, normalises them, and verifies each vendor through Kora's identity API. The buyer approves once, pays into a one-time virtual account, and the vendor is paid in two stages: 30% on acceptance, 70% when the buyer's delivery code is entered. Everything ends on a shareable record.

The signature element is the **Money Trail**: a continuous line with one node per step (Paid → Held → Stage 1 paid → Delivery code entered → Stage 2 paid → Complete). Each node carries a stamp with its Kora reference. The line only extends when money moves.

## About the design files
The files in `design/` are **design references built in HTML**. They are prototypes that show the intended look, copy and behaviour. They are not production code to ship. Recreate them in the target codebase's stack using its patterns. If there is no codebase yet, Next.js (App Router) + TypeScript + Tailwind or CSS modules is a sensible default. All state in the prototypes is mocked. Kora calls, vendor messaging and parsing need real implementations.

Open any `design/*.dc.html` in a browser (keep `support.js` beside them), or open the single-file versions in `standalone/`. Each `.dc.html` contains its markup (inline styles) followed by a `<script data-dc-script>` class whose `renderVals()` holds all state, data and handlers. Read that class for the exact logic.

## Fidelity
**High fidelity.** Final colours, type, spacing, copy and motion. Match pixel-for-pixel.

## Design tokens

### Colour (state colours mean one thing only)
| Token | Hex | Use |
|---|---|---|
| paper | #F6F3EC | All backgrounds |
| surface | #FBF9F4 | Raised surfaces (chips, documents, cards) |
| ink | #14140F | Text, all buttons, the Kora events panel |
| ink-hover | #2B2B24 | Primary button hover |
| muted | #5E5B52 | Secondary text, labels |
| hairline | #DCD7CB | 1px borders and dividers (header border #E4DFD3) |
| pending | #CFC9BB | Pending trail nodes, disabled buttons |
| on-ink-muted | #B5B1A4 / #D6D2C6 | Secondary text on the dark panel; dark-panel dividers #2E2E27 |
| green | #0B5D3B | Verified or paid. Nothing else |
| amber | #C9861A | Money held. Nothing else |
| red | #B3261E | A check failed. Nothing else |

### Type
Google Fonts: Bricolage Grotesque (opsz 12–96, wght 400–800), Inter (400/500/600), JetBrains Mono (400/500/600).

| Role | Font | Size | Line height | Tracking |
|---|---|---|---|---|
| Display | Bricolage 600 | clamp(88px,10vw,184px) | 0.86–0.88 | -0.055em |
| Headline | Bricolage 600 | clamp(52px,5.6vw,108px) | 0.92–0.95 | -0.045em to -0.05em |
| Title | Bricolage 600 | 22–40px | 1.0–1.05 | -0.03em |
| Body | Inter 400 | clamp(17px → 22px) | 1.5 | 0 |
| Label | Inter 500 | 13–16px, muted | 1 | 0 |
| Ledger | JetBrains Mono 500 | 11px (stamps) up to clamp(72px,10.4vw,196px) (account number) | 1 | -0.02em to -0.06em |

Rule: every amount, account number, reference, time and code is set in JetBrains Mono.

### Space, radius, depth
- Spacing scale: 8, 16, 24, 32, 48, 64, 88, 120, 160
- Page gutter: `clamp(24px, 4vw, 72px)`. Content max-width 1680px. The header is 72px tall, sticky, `rgba(246,243,236,0.88)` + `backdrop-filter: blur(16px)`
- Radius: 12px surfaces, 999px buttons, 6–8px stamps, 4px small pills, 44px phone frames
- **No shadows.** Depth comes from the surface tone, hairlines and type scale.

### Motion (slow, deliberate, never bouncy)
| Name | Spec |
|---|---|
| Resolve (messy → clean) | 900ms `cubic-bezier(.2,.7,.1,1)`; opacity 0→1, blur 10px→0, translateX -24px→0; 380ms stagger per row; the connector line scaleX 0→1 first |
| Chip split | `chipIn` 800–900ms; translateY -32px, blur 8px → none; 150ms stagger |
| Trail draw | width transition 1400ms `cubic-bezier(.65,0,.25,1)` (2800–3200ms on marketing pages) |
| Stamp press | `stampIn` 560ms `cubic-bezier(.2,.7,.1,1)`: scale 1.5 rotate -6deg opacity 0 → 55%: scale .985 rotate -2deg → scale 1 rotate -2deg. Stamps rest at -2deg |
| Strike (failed vendor) | red 3px bar scaleX 0→1, 700ms `cubic-bezier(.6,0,.2,1)` |
| Rise | `riseIn` 600–700ms, translateY 14–18px → 0 |
| Breathe | opacity .3↔1, 1.6–2.4s, for live/waiting indicators |

## Components
- **Primary button**: ink background, paper text, Inter 500 17px, padding 20px 32px, pill, `white-space:nowrap`, hover #2B2B24. Use one per screen.
- **Secondary button**: 1px ink border, transparent; on hover it inverts to ink/paper.
- **Text button**: underlined, offset 4px.
- **Kora stamp**: inline-flex, 1.5px border in the state colour, radius 6px, JetBrains Mono 500 11–13px, text in the state colour, `rotate(-2deg)`, presses in with `stampIn`. Content pattern: `KORA · <REF> · <Result>`.
- **Request chip**: surface, 1px hairline, radius 12, padding 28px; label (Inter 14 muted) above a value (Bricolage or Mono, clamp 30–52px).
- **Money Trail node**: 24px circle with 2px ring; done = filled in its state colour with an 8px paper core; pending = paper fill with a #CFC9BB ring. The label (Bricolage 600 17–22px) and amount (Mono) sit below, with the stamp below those. The track is 2px hairline, and the progress is 2px green running node centre to node centre.
- **Kora events panel**: the only dark surface. Ink, radius 12, padding 32. Each row is a 72px time column plus the event name (Mono 14), amount, detail (Inter 14 #D6D2C6), reference (Mono 12 #B5B1A4) and a "✓ Signature verified" pill (green bg, paper text, Inter 500 12px, radius 4). New rows rise in.
- **Header step nav**: 9px dots joined by 1px lines. Past steps are filled ink, the current step is outlined ink, future steps are outlined #B9B3A5. Each step is clickable.

## Screens (`design/ProcureAI App.dc.html`, desktop, designed at 1440, recorded at 1920×1080)
1. **Request**: an eyebrow "New purchase", then a textarea filling the width (Bricolage 600 clamp(52px,6.4vw,124px)). Below a hairline: the hint "Say what, how many, how much, and by when." and **Continue**. On submit the sentence shrinks into a muted quote and four chips split out (Item, Quantity, Budget, Deadline), followed by **Ask vendors**.
2. **Quotes**: a 3-column grid `minmax(0,4fr) | connector | minmax(0,8fr)`. On the left, the raw vendor replies kept verbatim (phone and time in Mono 13, text in Inter 18–22). In the middle, a dot, a line and a ring connector. On the right, the clean row: Vendor, Each, Total, Upfront, Ready. Rows resolve in sequence. Footer note: ProcureAI always pays 30%/70%, whatever the vendor asked for upfront. **Empty state**: "Waiting for vendors to reply.", 0 of 14 replied, dashed placeholder rows, a breathing dot.
3. **Recommendation**: a two-column layout. On the left, sticky: "Vendor B." (display), Kwik Threads ₦1,260,000, two explanation sentences and **Approve Vendor B**. On the right, a price-sorted list. Vendor A (₦3,900) has a red strike drawn through it, its opacity drops to .45, and a red stamp reads "✕ Company registration could not be verified." Vendor B's border animates to green; it shows a "Recommended" label, three green-ticked facts (Registered as Kwik Threads Garments Limited RC 1482093 / Status: Active / Payout account belongs to a registered director) and a Kora stamp. Vendor C shows "Verified · Not chosen. ₦90,000 more…". Sequence: "Checking with Kora…" for 1.2s, then the reveal.
4. **Pay**: the amount, then the account number "902 441 7368" at Mono clamp(72px,10.4vw,196px), then Bank / Account name / Closes in (a live mm:ss countdown from 29:41), **Copy number** and **I've sent it**. **Short state**: a red headline "₦60,000 short.", an explanation, an amber "₦1,200,000 held" figure, and the eyebrow changes to "Send the rest to this account". **Paid state**: the block is replaced by a large green stamp, "Payment confirmed", with ₦1,260,000 · KORA · KPY-CA-8F3K2Q9M · 11:05, then **Open tracker**.
5. **Tracker**: a dynamic headline, then the Money Trail at full width in 6 equal columns. Below it, on the left: "Still held" (amber Mono figure; it turns green at ₦0), the delivery code "481 906" with an explanation, and later the failure or complete block. On the right: the Kora events panel. **Failed payout state**: the Stage 2 node turns red, labelled "Stage 2 failed" with a stamp reading "KTR-9X4B7C · Failed", plus a red headline, an explanation and **Retry payout**. Retrying appends transfer.success and completes the trail.
6. **Record**: an 880px document on the surface colour. Header: the logo, "300 branded T-shirts", PA-2026-0417, dates and the buyer, above a 2px ink rule. Then five label/value sections (Request, Quotes, Why B, Checks, Money) with a "Left unaccounted ₦0" total, a fully green mini trail, and the stamp "COMPLETE · ALL REFERENCES SIGNED BY KORA". Actions: **Copy link**, **Save as image**.

Vendor mobile (`design/ProcureAI Vendor Mobile.dc.html`, 390×844):
7. **Quote request**: the request details, the payment terms, a free-text reply box and **Send quote**.
8. **Stage 1 paid**: "₦378,000 is on its way." with a stamp, a mini trail (paid / held / done), a 6-box delivery-code entry (60px boxes, radius 12) and **Confirm delivery**.
9. **Paid**: a full-screen green background, "Paid" at 168px, ₦882,000, the total received, a stamp and **View record**.

Marketing:
- `ProcureAI Home.dc.html`: the main homepage. A buying/vendor switch. The buying hero is "Tell it what you need." with a **tagline slot**, plus a live input that parses the typed sentence into four chips (regex in `parse()`; missing fields show "Not given") and example buttons. Then a full-width trail with an amber dot travelling along it, a "Who it's for" section of three rows each with **Try this**, three steps, a "What if it goes wrong?" section that expands answer by answer, a dark vendors band, a closing CTA and the footer.
- `ProcureAI Landing.dc.html`: the product scroll story. The hero types the request, then the Money Trail draws. Sections reveal as they scroll into view (IntersectionObserver, threshold 0.35): quotes resolve, Vendor A gets struck through, the account number, the two-stage payout bars (dark), vendors, and it closes on the receipt.
- `ProcureAI System.dc.html`: a token and component reference.

## State (App)
`screen` 0–5 · `submitted` · `resolved` (quotes) · `checked` (Kora) · `pay`: awaiting | short | paid · `secs` (countdown) · `step` 0–5 (last completed trail node) · `failed` / `failedOnce` · `events[]` (appended as webhooks arrive).
Entering Tracker animates `step` 0→1→2 and appends the stage-1 transfer event. Delivery sets step 3. After about 1.7s comes the stage-2 payout: success sets step 4, then 5; failure (when enabled) sets `failed`.
In production, drive these from Kora webhooks (`identity.cac`, `identity.bvn_match`, `charge.success`, `transfer.success`, `transfer.failed`), verify the webhook signatures, and only advance the trail when a verified event arrives.

The prototype includes a "Demo" control bar (top right) and tweakable props (`startScreen`, `quotes`, `payout`, `demoControls`) for recording. Don't build these into production.

## Copy rules
Sentence case. Plain words: "Paid", "Held", "Verified". Never "Processed successfully". Naira as ₦ with commas (₦1,260,000). Dates as "23 October". All copy in the files is final unless it's marked as a slot.

## Placeholder data
Vendor names, phone numbers, the RC number, Kora references (KPY-/KTR-/KID-), the Wema account number and the domain procureai.ng are illustrative. The tagline slot is waiting for final copy.

## Assets
No images or icons. The logo is CSS only: an 8px dot, an 18×2px bar and an 8px ring. Ticks and crosses are text glyphs (✓ ✕).

## Files
- `design/ProcureAI App.dc.html`: screens 1–6 with all their states
- `design/ProcureAI Vendor Mobile.dc.html`: screens 7–9
- `design/ProcureAI Home.dc.html`: homepage
- `design/ProcureAI Landing.dc.html`: scroll story
- `design/ProcureAI System.dc.html`: system reference
- `design/support.js`: the runtime needed to open the `.dc.html` files in a browser
- `standalone/*.html`: single-file offline versions of each page
