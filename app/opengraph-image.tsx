import { ImageResponse } from "next/og";

/** The picture shown when someone shares procureai.com.ng on WhatsApp, X, LinkedIn or Slack. */
export const alt = "ProcureAI: buy from vendors you don't know yet, without the gamble";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#F6F3EC", padding: "72px 80px", color: "#16150F" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 34, fontWeight: 700 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 12, height: 12, borderRadius: 6, background: "#16150F" }} />
            <div style={{ width: 28, height: 4, background: "#16150F" }} />
            <div style={{ width: 12, height: 12, borderRadius: 6, border: "3px solid #16150F" }} />
          </div>
          ProcureAI
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.02, letterSpacing: -3 }}>Buy from vendors you don&apos;t know yet.</div>
          <div style={{ fontSize: 32, color: "#5E5B52", lineHeight: 1.3 }}>Every vendor checked. Your money held until delivery. Vendors paid before they start.</div>
        </div>
        <div style={{ display: "flex", gap: 16, fontSize: 24, color: "#1F7A4D", fontWeight: 600 }}>procureai.com.ng</div>
      </div>
    ),
    size,
  );
}
