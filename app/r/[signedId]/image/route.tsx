import { ImageResponse } from "next/og";
import { verifyRecordId } from "@/lib/crypto";
import { buildRecordView } from "@/lib/views/record-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INK = "#14140F";
const MUTED = "#5E5B52";
const GREEN = "#0B5D3B";
const RED = "#B3261E";
const LINE = "#DCD7CB";

/** GET /r/:signedId/image — the record as a PNG ("Save as image"), rendered server-side. */
export async function GET(_req: Request, ctx: { params: Promise<{ signedId: string }> }): Promise<Response> {
  const { signedId } = await ctx.params;
  const orderId = verifyRecordId(signedId);
  if (!orderId) return new Response("Not found", { status: 404 });
  const r = await buildRecordView(orderId);
  const tone = (t: string) => (t === "green" ? GREEN : t === "red" ? RED : INK);

  const row = (label: string, children: React.ReactNode) => (
    <div style={{ display: "flex", gap: 24, padding: "20px 0", borderBottom: `1px solid ${LINE}` }}>
      <div style={{ width: 130, color: MUTED, fontSize: 15 }}>{label}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>{children}</div>
    </div>
  );

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#F6F3EC", padding: 40 }}>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, background: "#FBF9F4", border: `1px solid ${LINE}`, borderRadius: 12, padding: 48, color: INK }}>
          <div style={{ display: "flex", justifyContent: "space-between", paddingBottom: 24, borderBottom: `2px solid ${INK}` }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 18, fontWeight: 700 }}>ProcureAI</div>
              <div style={{ fontSize: 44, fontWeight: 700, marginTop: 18, letterSpacing: -1.5 }}>{r.title}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", color: MUTED, fontSize: 15, lineHeight: 1.7 }}>
              <span>{r.ref}</span>
              <span>{r.dates}</span>
              <span>Buyer: {r.buyer}</span>
            </div>
          </div>
          {row("1 · Request", <span style={{ fontSize: 18 }}>“{r.request}”</span>)}
          {row(
            "2 · Quotes",
            r.quotes.map((q) => (
              <div key={q.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 16, color: q.status === "Chosen" ? INK : MUTED }}>
                <span style={{ textDecoration: q.struck ? "line-through" : "none" }}>
                  {q.label} · {q.name} · {q.each}
                </span>
                <span style={{ color: q.status === "Not verified" ? RED : q.status === "Chosen" ? GREEN : MUTED }}>{q.status}</span>
              </div>
            )),
          )}
          {row(
            "4 · Checks",
            r.checks.map((c) => (
              <div key={c.text + c.ref} style={{ display: "flex", justifyContent: "space-between", fontSize: 15 }}>
                <span>{c.text}</span>
                <span style={{ color: tone(c.tone) }}>{c.ref}</span>
              </div>
            )),
          )}
          {row(
            "5 · Money",
            [
              ...r.money.map((m) => (
                <div key={m.label + m.ref} style={{ display: "flex", justifyContent: "space-between", fontSize: 15 }}>
                  <span>{m.label}</span>
                  <span>
                    {m.amount} <span style={{ color: tone(m.tone), marginLeft: 12 }}>{m.ref}</span>
                  </span>
                </div>
              )),
              <div key="total" style={{ display: "flex", justifyContent: "space-between", fontSize: 16, fontWeight: 700, borderTop: `2px solid ${INK}`, paddingTop: 10 }}>
                <span>Left unaccounted</span>
                <span>{r.unaccounted}</span>
              </div>,
            ],
          )}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "auto", paddingTop: 24 }}>
            <span style={{ color: MUTED, fontSize: 14 }}>{r.shareUrl.replace(/^https?:\/\//, "")}</span>
            {r.stamp ? <span style={{ border: `2px solid ${GREEN}`, color: GREEN, borderRadius: 6, padding: "8px 12px", fontSize: 13 }}>{r.stamp}</span> : null}
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 1500, headers: { "Content-Disposition": `attachment; filename="procureai-${r.ref}.png"` } },
  );
}
