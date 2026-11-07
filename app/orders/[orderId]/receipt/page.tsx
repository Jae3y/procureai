import type { Metadata } from "next";
import { PageMessage } from "@/components/states";
import { PrintButton } from "@/components/print-button";
import { Logo } from "@/components/ui";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { pageCanSeeOrder } from "@/lib/http/page-auth";
import { formatNaira } from "@/lib/money";
import { lagosDay, longOrderRef } from "@/lib/views/format";
import { buildRecordView } from "@/lib/views/record-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Receipt · ProcureAI" };

/** A printable receipt. Every amount is what Kora confirmed, with the Kora reference beside it. */
export default async function ReceiptPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const access = await pageCanSeeOrder(orderId);
  if (access !== "ok") return <PageMessage title="Receipt not found." body="Sign in with the account that made this purchase." action={{ href: "/login?next=/account", label: "Sign in" }} />;
  const order = await db().order.findUniqueOrThrow({ where: { id: orderId }, include: { request: { include: { buyer: true } }, vendor: true } });
  const r = await buildRecordView(orderId);
  return (
    <main className="page receipt">
      <section className="account-narrow">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
          <Logo />
          <PrintButton />
        </div>
        <h1 className="account-title" style={{ marginTop: 32 }}>Receipt</h1>
        <p className="mono muted">{longOrderRef(order.number, order.createdAt)} · {lagosDay(order.approvedAt)}</p>
        {order.request.isDemo || env().koraMode === "test" ? <p className="form-error">Test purchase: no real money moved.</p> : null}
        <dl className="receipt-grid">
          <dt>Buyer</dt>
          <dd>{order.request.buyer.name} · {order.request.buyer.email}</dd>
          <dt>Vendor</dt>
          <dd>{order.vendor.name ?? order.vendor.label}{order.vendor.rcNumber ? ` · ${order.vendor.rcNumber}` : ""}</dd>
          <dt>Item</dt>
          <dd>{order.request.quantity.toLocaleString("en-NG")} × {order.request.item}</dd>
          <dt>Agreed price</dt>
          <dd className="mono">{formatNaira(order.amountKobo)}</dd>
          <dt>Paid in</dt>
          <dd className="mono">{formatNaira(order.amountAcceptedKobo)}</dd>
        </dl>
        <h2 style={{ marginTop: 32 }}>Money movements</h2>
        <ul className="account-list">
          {r.money.map((m) => (
            <li key={`${m.label}-${m.ref}`}>
              <div>
                <strong>{m.label}</strong>
                <div className="mono muted" style={{ fontSize: 13 }}>{m.ref}</div>
              </div>
              <span className="mono">{m.amount}</span>
            </li>
          ))}
        </ul>
        <p className="note">{r.statusLine}</p>
        <p className="note" style={{ fontSize: 14 }}>
          Payments were collected and paid out by Kora. ProcureAI is a record of the purchase, not a tax invoice; ask the vendor for their invoice if you need one.
        </p>
      </section>
    </main>
  );
}
