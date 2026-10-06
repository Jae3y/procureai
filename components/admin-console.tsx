"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import type { AdminView } from "@/lib/views/admin-view";
import { useAction } from "./hooks";
import { Logo, Spinner } from "./ui";

type DemoBody = { action: string; orderId?: string; eventId?: string; route?: string };

/** Admin: demo controls, every Kora event (invalid signatures in red), outbox health. */
export function AdminConsole({ initial }: { initial: AdminView }) {
  const [v, setV] = useState(initial);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const demo = useAction<DemoBody, { message: string }>("/api/admin/demo");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/overview", { credentials: "same-origin" });
      if (res.ok) setV((await res.json()) as AdminView);
      else setMsg({ text: `Couldn't refresh (${res.status}).`, bad: true });
    } catch (err) {
      setMsg({ text: `Couldn't refresh: ${String(err)}`, bad: true });
    } finally {
      setLoading(false);
    }
  }, []);

  const act = async (body: DemoBody) => {
    const r = await demo.run(body);
    setMsg(r.ok ? { text: r.data.message, bad: false } : { text: r.error.message, bad: true });
    await refresh();
  };

  const liveOrder = v.orders.find((o) => !["COMPLETE", "REFUNDED"].includes(o.status));
  const currentRequest = v.requests.find((r) => r.status !== "CANCELLED");

  return (
    <main className="page">
      <header className="header">
        <div className="header-in">
          <Logo />
          <nav style={{ display: "flex", gap: 20 }} aria-label="Admin">
            <Link href="/admin" className="btn-text" aria-current="page">
              Overview
            </Link>
            <Link href="/admin/reconcile" className="btn-text">
              Reconciliation
            </Link>
          </nav>
        </div>
      </header>
      <section className="admin">
        <h1>Admin</h1>
        <p className="note">
          Kora {v.mode.koraMode} mode · identity {v.mode.simulateIdentity ? <strong className="red">SIMULATED</strong> : "live sandbox"} · AI{" "}
          {v.mode.aiEnabled ? v.mode.aiModel : "off (rule-based parser)"} · webhooks to <span className="mono">{v.mode.webhookUrl}</span>
        </p>
        <div className="ctl-row">
          <button type="button" className="btn-2" disabled={loading} onClick={() => void refresh()}>
            {loading ? <Spinner label="Refreshing" /> : "Refresh"}
          </button>
          <button type="button" className="btn-2" disabled={demo.pending} onClick={() => void act({ action: "tick" })}>
            Run poller now
          </button>
        </div>

        {v.mode.demoMode ? (
          <>
            <h2>Demo controls</h2>
            <div className="grid-2">
              <div className="panel">
                <div className="label" style={{ marginBottom: 12 }}>
                  Live order {liveOrder ? <span className="mono">{liveOrder.ref} · {liveOrder.status}</span> : "— none open"}
                </div>
                <div className="ctl-row">
                  <button type="button" className="btn-2" disabled={!liveOrder || demo.pending} onClick={() => liveOrder && void act({ action: "pay", orderId: liveOrder.id })}>
                    Pay the account (sandbox)
                  </button>
                  <button type="button" className="btn-2" disabled={!liveOrder || demo.pending} onClick={() => liveOrder && void act({ action: "underpay", orderId: liveOrder.id })}>
                    Force underpayment
                  </button>
                  <button type="button" className="btn-2" disabled={!liveOrder || demo.pending} onClick={() => liveOrder && void act({ action: "recheck", orderId: liveOrder.id })}>
                    Re-check with Kora
                  </button>
                  <button type="button" className="btn-2" disabled={!liveOrder || demo.pending} onClick={() => liveOrder && void act({ action: "retry-stage", orderId: liveOrder.id })}>
                    Retry blocked stage
                  </button>
                  {liveOrder ? (
                    <Link className="btn-text" href={liveOrder.trackerPath}>
                      Open tracker
                    </Link>
                  ) : null}
                </div>
              </div>
              <div className="panel">
                <div className="label" style={{ marginBottom: 12 }}>
                  Next payout goes to: <strong>{v.settings.payoutRoute}</strong>
                  {v.settings.suppressNextWebhook ? <span className="red"> · next webhook will be suppressed</span> : null}
                </div>
                <div className="ctl-row">
                  <button type="button" className="btn-2" disabled={demo.pending} onClick={() => void act({ action: "route", route: "SANDBOX_FAIL_035" })}>
                    Force payout failure (035)
                  </button>
                  <button type="button" className="btn-2" disabled={demo.pending} onClick={() => void act({ action: "route", route: "VERIFIED_ACCOUNT" })}>
                    Pay the verified account
                  </button>
                  <button type="button" className="btn-2" disabled={demo.pending} onClick={() => void act({ action: "route", route: "SANDBOX_SUCCESS_033" })}>
                    Use Kora&apos;s 033 success account
                  </button>
                  <button type="button" className="btn-2" disabled={demo.pending || v.settings.suppressNextWebhook} onClick={() => void act({ action: "suppress" })}>
                    Suppress the next webhook
                  </button>
                </div>
              </div>
            </div>

            {currentRequest ? (
              <>
                <h2>Vendor links · {currentRequest.text}</h2>
                <p className="note">ProcureAI does not send WhatsApp/SMS; share these links with vendors. Open Vendor B&apos;s on a phone for the demo.</p>
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Vendor</th>
                        <th>Replied</th>
                        <th>Link</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentRequest.invites.map((i) => (
                        <tr key={i.label}>
                          <td>
                            {i.label} · {i.name}
                          </td>
                          <td>{i.replied ? "✓ Replied" : "Not yet"}</td>
                          <td className="mono">
                            <a href={i.link}>{i.link}</a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
          </>
        ) : null}

        <h2>Orders</h2>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Ref</th>
                <th>Item</th>
                <th>Vendor</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {v.orders.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    No orders yet.
                  </td>
                </tr>
              ) : (
                v.orders.map((o) => (
                  <tr key={o.id}>
                    <td className="mono">
                      <Link href={o.trackerPath}>{o.ref}</Link>
                    </td>
                    <td>{o.item}</td>
                    <td>{o.vendor}</td>
                    <td className="mono">{o.amount}</td>
                    <td className="mono">{o.status}</td>
                    <td className="mono">{o.updated}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <h2>
          Kora events · outbox {v.outbox.pending} pending
          {v.outbox.parked ? <span className="red"> · {v.outbox.parked} parked</span> : null}
        </h2>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Received</th>
                <th>Event</th>
                <th>Reference</th>
                <th>Source</th>
                <th>Signature</th>
                <th>Processed</th>
                <th>Order</th>
                <th>Replay</th>
              </tr>
            </thead>
            <tbody>
              {v.events.length === 0 ? (
                <tr>
                  <td colSpan={8} className="muted">
                    No Kora events yet.
                  </td>
                </tr>
              ) : (
                v.events.map((e) => (
                  <tr key={e.id} className={e.signature === "invalid" || e.error ? "bad" : undefined}>
                    <td className="mono">{e.when}</td>
                    <td className="mono">{e.type}</td>
                    <td className="mono">{e.reference}</td>
                    <td>{e.source === "WEBHOOK" ? "Webhook" : "Kora API"}</td>
                    <td>
                      {e.signature === "valid" ? (
                        <span className="pill green">✓ Valid ({e.method})</span>
                      ) : e.signature === "invalid" ? (
                        <span className="pill red">✕ Invalid ({e.method})</span>
                      ) : (
                        <span className="muted">n/a</span>
                      )}
                    </td>
                    <td>
                      {e.error ? <span className="red">{e.error}</span> : e.processed ? "✓" : "Pending"}
                      {e.note ? <div className="muted" style={{ fontSize: 12 }}>{e.note}</div> : null}
                    </td>
                    <td className="mono">{e.order ?? "—"}</td>
                    <td>
                      {e.replayable && e.signature === "valid" ? (
                        <div className="ctl-row">
                          <button type="button" className="btn-text" disabled={demo.pending} onClick={() => void act({ action: "replay", eventId: e.id })}>
                            Replay
                          </button>
                          <button type="button" className="btn-text" disabled={demo.pending} onClick={() => void act({ action: "corrupt", eventId: e.id })}>
                            Corrupt signature
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
      {msg ? (
        <div className={`toast${msg.bad ? " err" : ""}`} role={msg.bad ? "alert" : "status"}>
          {msg.text}
        </div>
      ) : null}
    </main>
  );
}

export function AdminLogin() {
  const [token, setToken] = useState("");
  const login = useAction<{ token: string }>("/api/admin/session");
  return (
    <main className="page">
      <header className="header">
        <div className="header-in">
          <Logo />
        </div>
      </header>
      <section className="request">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void login.run({ token }).then((r) => {
              if (r.ok) window.location.reload();
            });
          }}
          style={{ maxWidth: 420 }}
        >
          <h1 className="headline">Admin</h1>
          <div className="field" style={{ marginTop: 32 }}>
            <label htmlFor="admin-token">Admin token</label>
            <input id="admin-token" className="input" type="password" autoComplete="current-password" value={token} onChange={(e) => setToken(e.target.value)} />
          </div>
          <button type="submit" className="btn" style={{ marginTop: 24 }} disabled={login.pending || !token}>
            {login.pending ? <Spinner label="Checking" /> : "Open admin"}
          </button>
          {login.error ? <p className="form-error">{login.error.message}</p> : null}
        </form>
      </section>
    </main>
  );
}
