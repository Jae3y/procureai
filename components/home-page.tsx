"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Logo } from "./ui";

interface ChipData {
  label: string;
  value: string;
  mono: boolean;
  color?: string;
  delay: string;
}

interface ParsedRequest {
  qty: string | null;
  item: string | null;
  budget: number | null;
  date: string | null;
}

const EXAMPLES = [
  { short: "300 T-shirts for an event", full: "300 branded T-shirts, under ₦1.5m, delivered by 23 October" },
  { short: "120 lab coats for a class", full: "120 lab coats, under ₦1.1m, delivered by 30 October" },
  { short: "40 cartons for a shop", full: "40 cartons of noodles, under ₦600k, delivered by 12 October" },
];

const PEOPLE = [
  {
    num: "01",
    who: "Event organisers",
    pain: "Merch, chairs and catering for hundreds of guests, paid for by sponsors who want to know where it went.",
    ex: 0,
  },
  {
    num: "02",
    who: "Class reps",
    pain: "Everyone sends you ₦9,000. Now you have to find a tailor, pay a deposit, and answer to 120 people.",
    ex: 1,
  },
  {
    num: "03",
    who: "Shop owners",
    pain: "Restocking from new suppliers without sending a full payment to someone you met on Instagram.",
    ex: 2,
  },
];

const FAQS = [
  {
    q: "The vendor never delivers.",
    a: "Your delivery code is never entered, so the remaining 70% never leaves the held account. You can dispute and request a full refund of what remains.",
  },
  {
    q: "I send the wrong amount.",
    a: "Nothing moves until the full amount is covered. ProcureAI displays exactly how much is short and opens an account for the shortfall.",
  },
  {
    q: "A vendor is not a real business.",
    a: "Kora checks every vendor against CAC records and confirms director account ownership before you see a recommendation. Vendors that fail verification cannot be approved or paid.",
  },
  {
    q: "People ask where their money went.",
    a: "Share the permanent record link. It lists every quote, the reason for the decision, and a verifiable Kora reference for every single naira in and out.",
  },
];

const defaultExample = EXAMPLES[0]!;
const getExample = (idx: number) => EXAMPLES[idx] ?? defaultExample;

function formatNaira(n: number): string {
  return "₦" + Math.round(n).toLocaleString("en-NG");
}

function parseText(t: string): ParsedRequest {
  const qm = t.match(/^\s*([\d,]+)\s+(.+?)(?:,|\s+under|\s+for|\s+by|$)/i);
  const bm = t.match(/(?:under|below|max|budget|for)\s*(?:₦|N)?\s*([\d.,]+)\s*(m|k)?/i);
  const dm = t.match(/by\s+(\d{1,2}\s+[A-Za-z]+)/i);
  let budget: number | null = null;
  if (bm && bm[1]) {
    let v = parseFloat(bm[1].replace(/,/g, ""));
    const u = (bm[2] || "").toLowerCase();
    if (u === "m") v *= 1e6;
    if (u === "k") v *= 1e3;
    budget = v;
  }
  const qty = qm && qm[1] ? qm[1] : null;
  const item = qm && qm[2] ? qm[2].replace(/\s+/g, " ").trim() : null;
  const date = dm && dm[1] ? dm[1].replace(/^(\d+)\s+(\w)/, (_, a: string, b: string) => a + " " + b.toUpperCase()) : null;
  return {
    qty,
    item,
    budget,
    date,
  };
}

/** Landing tagline: edit here. */
const TAGLINE = ["Buy like you checked everyone.", "Because we did."];

export function HomePage() {
  const router = useRouter();
  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<ParsedRequest | null>(null);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    const iv = setInterval(() => {
      setPlaceholderIdx((prev) => (prev + 1) % EXAMPLES.length);
    }, 3600);
    const tm = setTimeout(() => setDrawn(true), 400);
    return () => {
      clearInterval(iv);
      clearTimeout(tm);
    };
  }, []);

  const runParse = (customText?: string) => {
    const t = (customText ?? text).trim() || getExample(placeholderIdx).full;
    setText(t);
    const result = parseText(t);
    setParsed(result);
  };

  const handleUseExample = (idx: number) => {
    setMode("buy");
    const ex = getExample(idx).full;
    runParse(ex);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const effectiveText = text.trim() || getExample(placeholderIdx).full;
    if (!parsed) {
      runParse(effectiveText);
    } else {
      router.push(`/buy?text=${encodeURIComponent(effectiveText)}`);
    }
  };

  const chips: ChipData[] = parsed
    ? [
        {
          label: "Item",
          value: parsed.item ? parsed.item.charAt(0).toUpperCase() + parsed.item.slice(1) : "Not given",
          mono: false,
          color: parsed.item ? "var(--ink)" : "var(--muted)",
          delay: "140ms",
        },
        {
          label: "Quantity",
          value: parsed.qty || "Not given",
          mono: true,
          color: parsed.qty ? "var(--ink)" : "var(--muted)",
          delay: "280ms",
        },
        {
          label: "Budget",
          value: parsed.budget ? formatNaira(parsed.budget) : "Not given",
          mono: true,
          color: parsed.budget ? "var(--ink)" : "var(--muted)",
          delay: "420ms",
        },
        {
          label: "Deadline",
          value: parsed.date || "Not given",
          mono: false,
          color: parsed.date ? "var(--ink)" : "var(--muted)",
          delay: "560ms",
        },
      ]
    : [];

  const missingCount = chips.filter((c) => c.value === "Not given").length;

  return (
    <div style={{ background: "var(--paper)", overflowX: "hidden", minHeight: "100vh" }}>
      <header className="header">
        <div className="header-in">
          <Logo />
          <nav style={{ display: "flex", alignItems: "center", gap: "clamp(16px, 2.4vw, 36px)", font: "500 15px/1 var(--font-body)", whiteSpace: "nowrap" }}>
            <a href="#how" className="btn-text" style={{ textDecoration: "none" }}>
              How it works
            </a>
            <a href="#who" className="btn-text" style={{ textDecoration: "none" }}>
              Who it&apos;s for
            </a>
            <a href="#vendors" className="btn-text" style={{ textDecoration: "none" }}>
              For vendors
            </a>
            <Link href="/demo" className="btn-text" style={{ textDecoration: "none" }}>
              Demo
            </Link>
            <Link href="/buy" className="btn btn-sm">
              Start a purchase
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <section style={{ maxWidth: "var(--max)", margin: "0 auto", padding: "clamp(56px, 8vh, 112px) var(--gutter) 0", boxSizing: "border-box" }}>
        <div style={{ display: "inline-flex", padding: 4, border: "1px solid var(--hairline)", borderRadius: 999, background: "var(--surface)", gap: 4 }}>
          <button
            type="button"
            onClick={() => setMode("buy")}
            style={{
              border: 0,
              borderRadius: 999,
              padding: "11px 20px",
              font: "500 15px/1 var(--font-body)",
              cursor: "pointer",
              whiteSpace: "nowrap",
              background: mode === "buy" ? "var(--ink)" : "transparent",
              color: mode === "buy" ? "var(--paper)" : "var(--ink)",
              transition: "all 300ms",
            }}
          >
            I&apos;m buying
          </button>
          <button
            type="button"
            onClick={() => setMode("sell")}
            style={{
              border: 0,
              borderRadius: 999,
              padding: "11px 20px",
              font: "500 15px/1 var(--font-body)",
              cursor: "pointer",
              whiteSpace: "nowrap",
              background: mode === "sell" ? "var(--ink)" : "transparent",
              color: mode === "sell" ? "var(--paper)" : "var(--ink)",
              transition: "all 300ms",
            }}
          >
            I&apos;m a vendor
          </button>
        </div>

        {mode === "buy" ? (
          <div>
            <h1 className="headline" style={{ marginTop: 40, fontSize: "clamp(64px, 9.6vw, 184px)", lineHeight: 0.88 }}>
              Tell it what you need.
            </h1>
            <div style={{ marginTop: 28, display: "inline-flex", border: "1.5px dashed var(--future)", borderRadius: 12, padding: "14px 20px", font: "500 14px/1.2 var(--font-mono)", color: "var(--muted)" }}>
              Buy in bulk with pooled money. Kora verifies, holds, and releases in two stages.
            </div>

            <form
              onSubmit={handleSubmit}
              style={{
                marginTop: "clamp(48px, 6vh, 80px)",
                border: "1.5px solid var(--ink)",
                borderRadius: 12,
                background: "var(--surface)",
                padding: "clamp(20px, 2.4vw, 36px) clamp(24px, 3vw, 44px)",
                display: "flex",
                alignItems: "center",
                gap: 24,
                flexWrap: "wrap",
              }}
            >
              <input
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setParsed(null);
                }}
                placeholder={getExample(placeholderIdx).full}
                style={{
                  flex: 1,
                  minWidth: 260,
                  border: 0,
                  outline: "none",
                  background: "transparent",
                  font: "600 clamp(24px, 3vw, 50px)/1.1 var(--font-display)",
                  letterSpacing: "-0.035em",
                  color: "var(--ink)",
                  padding: 0,
                }}
              />
              <button type="submit" className="btn btn-lg">
                {parsed ? "Start purchase" : "Try it"} <span className="arrow">→</span>
              </button>
            </form>

            {parsed ? (
              <div style={{ marginTop: 24 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
                  {chips.map((c) => (
                    <div
                      key={c.label}
                      style={{
                        border: "1px solid var(--hairline)",
                        borderRadius: 12,
                        padding: "20px 24px 24px",
                        background: "var(--surface)",
                        animation: "chipIn 800ms var(--ease-resolve) both",
                        animationDelay: c.delay,
                      }}
                    >
                      <div className="label">{c.label}</div>
                      <div
                        style={{
                          marginTop: 20,
                          fontSize: "clamp(24px, 2.2vw, 38px)",
                          fontFamily: c.mono ? "var(--font-mono)" : "var(--font-display)",
                          fontWeight: c.mono ? 500 : 600,
                          letterSpacing: "-0.03em",
                          color: c.color,
                        }}
                      >
                        {c.value}
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 20, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                  <span className="note">
                    {missingCount > 0
                      ? "Add the missing part and ProcureAI can start asking vendors."
                      : "That is everything ProcureAI needs to start asking vendors."}
                  </span>
                  <Link href={`/buy?text=${encodeURIComponent(text || getExample(placeholderIdx).full)}`} className="btn-text">
                    Continue in the app →
                  </Link>
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 20, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <span className="note" style={{ marginRight: 6 }}>
                  Try
                </span>
                {EXAMPLES.map((e, idx) => (
                  <button
                    key={e.short}
                    type="button"
                    onClick={() => handleUseExample(idx)}
                    style={{
                      border: "1px solid var(--hairline)",
                      background: "transparent",
                      borderRadius: 999,
                      padding: "10px 16px",
                      font: "500 14px/1 var(--font-body)",
                      color: "var(--ink)",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {e.short}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: "clamp(40px, 6vw, 120px)", alignItems: "end", marginTop: 40 }}>
            <div>
              <h1 className="headline" style={{ fontSize: "clamp(64px, 8.4vw, 164px)", lineHeight: 0.88 }}>
                Get paid for what you deliver.
              </h1>
              <p className="body-lg" style={{ marginTop: 32, color: "var(--muted)", maxWidth: "40ch" }}>
                Buyers send you a link. Reply in your own words. If they choose you, 30% lands in your business account the moment you accept, and the rest the moment you deliver.
              </p>
              <div style={{ marginTop: 40 }}>
                <Link href="/demo" className="btn btn-lg">
                  See what vendors see <span className="arrow">→</span>
                </Link>
              </div>
            </div>
            <div style={{ border: "1px solid var(--hairline)", borderRadius: 12, background: "var(--surface)", padding: "clamp(28px, 3vw, 48px)" }}>
              <div className="label">Order PA-0417 · 300 T-shirts</div>
              <div style={{ marginTop: 20, font: "500 clamp(48px, 5vw, 88px)/1 var(--font-mono)", letterSpacing: "-0.06em", color: "var(--green)" }}>
                ₦378,000
              </div>
              <div style={{ marginTop: 8, font: "600 clamp(28px, 2.6vw, 44px)/1 var(--font-display)", letterSpacing: "-0.035em" }}>
                is on its way.
              </div>
              <div style={{ marginTop: 24 }}>
                <span className="stamp green press">KORA · KTR-1P6W2D</span>
              </div>
              <div style={{ marginTop: 32, paddingTop: 20, borderTop: "1px solid var(--hairline)", display: "flex", justifyContent: "space-between", gap: 16, font: "500 14px/1.3 var(--font-mono)" }}>
                <span className="amber">₦882,000 held for you</span>
                <span className="muted">Released on delivery</span>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Full-width continuous Money Trail */}
      <section style={{ padding: "clamp(80px, 10vh, 128px) 0" }}>
        <div style={{ position: "relative", maxWidth: "var(--max)", margin: "0 auto", padding: "0 var(--gutter)" }}>
          <div style={{ position: "relative", height: 2, background: "var(--hairline)" }}>
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                height: 2,
                background: "var(--green)",
                width: drawn ? "100%" : "0%",
                transition: "width 2800ms var(--ease-trail)",
              }}
            />
          </div>
          <div style={{ marginTop: 28, display: "flex", justifyContent: "space-between", gap: 12, font: "500 clamp(12px, 1vw, 15px)/1.3 var(--font-mono)", color: "var(--muted)", flexWrap: "wrap" }}>
            <span>Request</span>
            <span>Quotes</span>
            <span>Checked by Kora</span>
            <span>Held</span>
            <span>Stage 1 paid</span>
            <span>Delivered</span>
            <span>Stage 2 paid</span>
            <span style={{ color: "var(--ink)", fontWeight: 600 }}>On the record</span>
          </div>
        </div>
      </section>

      {/* Who it's for */}
      <section id="who" style={{ borderTop: "1px solid var(--hairline)" }}>
        <div style={{ maxWidth: "var(--max)", margin: "0 auto", padding: "clamp(96px, 12vh, 160px) var(--gutter)", boxSizing: "border-box" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: "clamp(32px, 5vw, 96px)", alignItems: "end" }}>
            <h2 className="headline" style={{ fontSize: "clamp(48px, 6vw, 116px)", lineHeight: 0.92 }}>
              For anyone spending money that isn&apos;t only theirs.
            </h2>
            <p className="body-lg" style={{ color: "var(--muted)", maxWidth: "40ch" }}>
              When other people chipped in, you need more than a receipt from WhatsApp. You need to show where every naira went.
            </p>
          </div>
          <div style={{ marginTop: 80, borderTop: "1px solid var(--ink)" }}>
            {PEOPLE.map((p) => (
              <div
                key={p.num}
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))",
                  gap: "24px 48px",
                  alignItems: "center",
                  padding: "40px 0",
                  borderBottom: "1px solid var(--hairline)",
                }}
              >
                <div>
                  <div style={{ font: "500 14px/1 var(--font-mono)", color: "var(--muted)" }}>{p.num}</div>
                  <div style={{ marginTop: 14, font: "600 clamp(32px, 3vw, 52px)/1 var(--font-display)", letterSpacing: "-0.04em" }}>{p.who}</div>
                </div>
                <div style={{ font: "400 clamp(17px, 1.25vw, 20px)/1.5 var(--font-body)", color: "var(--muted)", maxWidth: "38ch" }}>{p.pain}</div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20 }}>
                  <span style={{ font: "500 clamp(16px, 1.2vw, 19px)/1.4 var(--font-mono)", maxWidth: "30ch" }}>“{getExample(p.ex).full}”</span>
                  <button
                    type="button"
                    onClick={() => handleUseExample(p.ex)}
                    className="btn-2 btn-sm"
                  >
                    Try this
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Three steps */}
      <section id="how" style={{ borderTop: "1px solid var(--hairline)" }}>
        <div style={{ maxWidth: "var(--max)", margin: "0 auto", padding: "clamp(96px, 12vh, 160px) var(--gutter)", boxSizing: "border-box" }}>
          <h2 className="headline" style={{ fontSize: "clamp(48px, 6vw, 116px)", lineHeight: 0.92, maxWidth: "14ch" }}>
            Three steps. You do one of them.
          </h2>
          <div style={{ marginTop: 88, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: 48 }}>
            <div style={{ borderTop: "2px solid var(--ink)", paddingTop: 28 }}>
              <div style={{ font: "500 clamp(56px, 5vw, 96px)/1 var(--font-mono)", letterSpacing: "-0.06em" }}>01</div>
              <div style={{ marginTop: 28, font: "600 clamp(26px, 2.2vw, 36px)/1 var(--font-display)", letterSpacing: "-0.03em" }}>
                It asks around
              </div>
              <p style={{ margin: "14px 0 0", font: "400 17px/1.55 var(--font-body)", color: "var(--muted)", maxWidth: "34ch" }}>
                ProcureAI messages vendors, reads their replies however they&apos;re written, and lines up the quotes.
              </p>
            </div>
            <div style={{ borderTop: "2px solid var(--green)", paddingTop: 28 }}>
              <div style={{ font: "500 clamp(56px, 5vw, 96px)/1 var(--font-mono)", letterSpacing: "-0.06em", color: "var(--green)" }}>02</div>
              <div style={{ marginTop: 28, font: "600 clamp(26px, 2.2vw, 36px)/1 var(--font-display)", letterSpacing: "-0.03em" }}>
                Kora checks them
              </div>
              <p style={{ margin: "14px 0 0", font: "400 17px/1.55 var(--font-body)", color: "var(--muted)", maxWidth: "34ch" }}>
                Every vendor is checked against company registration records. Any vendor that fails is dropped, even if it was the cheapest.
              </p>
            </div>
            <div style={{ borderTop: "2px solid var(--amber)", paddingTop: 28 }}>
              <div style={{ font: "500 clamp(56px, 5vw, 96px)/1 var(--font-mono)", letterSpacing: "-0.06em", color: "var(--amber)" }}>03</div>
              <div style={{ marginTop: 28, font: "600 clamp(26px, 2.2vw, 36px)/1 var(--font-display)", letterSpacing: "-0.03em" }}>
                You approve once
              </div>
              <p style={{ margin: "14px 0 0", font: "400 17px/1.55 var(--font-body)", color: "var(--muted)", maxWidth: "34ch" }}>
                Pay into an account made for this purchase. It&apos;s held, then released in two stages: on acceptance and on delivery.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* What if it goes wrong? */}
      <section style={{ borderTop: "1px solid var(--hairline)" }}>
        <div style={{ maxWidth: "var(--max)", margin: "0 auto", padding: "clamp(96px, 12vh, 160px) var(--gutter)", boxSizing: "border-box", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: "clamp(40px, 6vw, 120px)", alignItems: "start" }}>
          <h2 className="headline" style={{ fontSize: "clamp(48px, 6vw, 116px)", lineHeight: 0.92 }}>
            What if it goes wrong?
          </h2>
          <div style={{ borderTop: "1px solid var(--ink)" }}>
            {FAQS.map((f, i) => {
              const isOpen = openFaq === i;
              return (
                <div key={f.q} style={{ borderBottom: "1px solid var(--hairline)" }}>
                  <button
                    type="button"
                    onClick={() => setOpenFaq(isOpen ? null : i)}
                    style={{
                      width: "100%",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 24,
                      background: "none",
                      border: 0,
                      padding: "28px 0",
                      cursor: "pointer",
                      textAlign: "left",
                      font: "600 clamp(20px, 1.7vw, 28px)/1.2 var(--font-display)",
                      letterSpacing: "-0.025em",
                      color: "var(--ink)",
                    }}
                  >
                    <span>{f.q}</span>
                    <span style={{ flexShrink: 0, font: "400 28px/1 var(--font-body)", transform: isOpen ? "rotate(45deg)" : "rotate(0deg)", transition: "transform 400ms var(--ease-resolve)" }}>
                      +
                    </span>
                  </button>
                  <div style={{ display: "grid", gridTemplateRows: isOpen ? "1fr" : "0fr", transition: "grid-template-rows 400ms var(--ease-resolve)" }}>
                    <div style={{ overflow: "hidden" }}>
                      <p style={{ margin: 0, padding: "0 48px 28px 0", font: "400 18px/1.55 var(--font-body)", color: "var(--muted)", maxWidth: "56ch" }}>
                        {f.a}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* For Vendors (Dark Section) */}
      <section id="vendors" style={{ background: "var(--ink)", color: "var(--paper)" }}>
        <div style={{ maxWidth: "var(--max)", margin: "0 auto", padding: "clamp(96px, 12vh, 160px) var(--gutter)", boxSizing: "border-box" }}>
          <div style={{ font: "500 15px/1 var(--font-mono)", color: "var(--on-ink-muted)" }}>For vendors</div>
          <h2 className="headline" style={{ marginTop: 24, fontSize: "clamp(48px, 6.4vw, 124px)", lineHeight: 0.92, maxWidth: "14ch", color: "var(--paper)" }}>
            No more “send deposit first”.
          </h2>
          <div style={{ marginTop: 80, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: 40 }}>
            <div style={{ borderTop: "1px solid var(--on-ink-line)", paddingTop: 24 }}>
              <div style={{ font: "600 26px/1.1 var(--font-display)", letterSpacing: "-0.025em" }}>Reply in your own words</div>
              <p style={{ margin: "12px 0 0", font: "400 17px/1.55 var(--font-body)", color: "var(--on-ink-soft)" }}>
                “I fit do am 4,200 each” works. No forms, no app to install.
              </p>
            </div>
            <div style={{ borderTop: "1px solid var(--on-ink-line)", paddingTop: 24 }}>
              <div style={{ font: "600 26px/1.1 var(--font-display)", letterSpacing: "-0.025em" }}>The money is already there</div>
              <p style={{ margin: "12px 0 0", font: "400 17px/1.55 var(--font-body)", color: "var(--on-ink-soft)" }}>
                The buyer pays before you start. You can see it held for you.
              </p>
            </div>
            <div style={{ borderTop: "1px solid var(--on-ink-line)", paddingTop: 24 }}>
              <div style={{ font: "600 26px/1.1 var(--font-display)", letterSpacing: "-0.025em" }}>Registered businesses win</div>
              <p style={{ margin: "12px 0 0", font: "400 17px/1.55 var(--font-body)", color: "var(--on-ink-soft)" }}>
                If you&apos;re registered and your account is in your company&apos;s name, you&apos;re chosen over a cheaper vendor that can&apos;t be verified.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Closing Call-to-Action */}
      <section style={{ borderTop: "1px solid var(--hairline)" }}>
        <div style={{ maxWidth: "var(--max)", margin: "0 auto", padding: "clamp(112px, 14vh, 200px) var(--gutter)", boxSizing: "border-box", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center" }}>
          <h2 className="headline" style={{ fontSize: "clamp(34px, 5.4vw, 104px)", lineHeight: 0.98, textWrap: "balance" }}>
            {TAGLINE[0]}
            <br />
            {TAGLINE[1]}
          </h2>
          <p className="body-lg" style={{ marginTop: 32, color: "var(--muted)", maxWidth: "40ch" }}>
            Every purchase ends on a record you can drop into the group chat.
          </p>
          <p className="body-lg" style={{ marginTop: 16, maxWidth: "40ch", fontWeight: 600 }}>
            30% on acceptance, 70% on delivery.
          </p>
          <div style={{ marginTop: 56, display: "flex", gap: 16, flexWrap: "wrap", justifyContent: "center" }}>
            <Link href="/buy" className="btn btn-lg">
              Start a purchase
            </Link>
            <Link href="/demo" className="btn-2 btn-lg">
              Explore interactive demo
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ borderTop: "1px solid var(--hairline)" }}>
        <div style={{ maxWidth: "var(--max)", margin: "0 auto", padding: "40px var(--gutter)", display: "flex", justifyContent: "space-between", gap: 24, flexWrap: "wrap", font: "400 14px/1.5 var(--font-body)", color: "var(--muted)" }}>
          <span>ProcureAI · Lagos</span>
          <span style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <Link href="/demo" style={{ color: "var(--muted)" }}>
              Demo scenario
            </Link>
            <Link href="/sample" style={{ color: "var(--muted)" }}>
              See a completed record
            </Link>
            <span>Payments and identity checks by Kora</span>
          </span>
        </div>
      </footer>
    </div>
  );
}
