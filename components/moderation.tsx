"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAction } from "./hooks";
import { Spinner } from "./ui";

const REASONS: Array<[string, string]> = [
  ["misleading", "Misleading (wrong price, photo or description)"],
  ["illegal", "Illegal to sell"],
  ["counterfeit", "Fake or counterfeit"],
  ["unsafe", "Unsafe"],
  ["scam", "Looks like a scam"],
  ["other", "Something else"],
];

/** A quiet "Report this listing" link that opens a short form. */
export function ReportListing({ listingId }: { listingId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const send = useAction<{ reason: string; note: string }>(`/api/market/listings/${listingId}/report`);
  const [done, setDone] = useState(false);
  if (done) return <p className="note" role="status" style={{ fontSize: 14 }}>Thank you. We&apos;ll look at this listing.</p>;
  if (!open)
    return (
      <button type="button" className="btn-text" style={{ fontSize: 14 }} onClick={() => setOpen(true)}>
        Report this listing
      </button>
    );
  return (
    <form
      noValidate
      className="account-form"
      style={{ marginTop: 8 }}
      onSubmit={(e) => {
        e.preventDefault();
        void send.run({ reason, note }).then((r) => r.ok && setDone(true));
      }}
    >
      <div className="field">
        <label htmlFor="rp-reason">What&apos;s wrong with it?</label>
        <select id="rp-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="">Choose a reason</option>
          {REASONS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="rp-note">Anything we should know? (optional)</label>
        <textarea id="rp-note" className="input" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button type="submit" className="btn-2" disabled={send.pending || !reason}>
          {send.pending ? <Spinner label="Sending" /> : "Send report"}
        </button>
        <button type="button" className="btn-text" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {send.error ? <p className="form-error">{send.error.message}</p> : null}
    </form>
  );
}

/** Admin: take a listing down (with a reason the seller sees) or put it back. */
export function ModerateListing({ listingId, removed }: { listingId: string; removed: boolean }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const act = useAction<{ action: string; note?: string }>(`/api/admin/listings/${listingId}`);
  return (
    <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
      {removed ? null : (
        <input className="input" placeholder="Reason the seller will see, e.g. The photo isn't of the product." value={note} onChange={(e) => setNote(e.target.value)} />
      )}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {removed ? null : (
          <button type="button" className="btn-2" disabled={act.pending} onClick={() => void act.run({ action: "take-down", note }).then((r) => r.ok && router.refresh())}>
            Take down
          </button>
        )}
        <button type="button" className="btn-text" disabled={act.pending} onClick={() => void act.run({ action: "restore" }).then((r) => r.ok && router.refresh())}>
          {removed ? "Put it back" : "Keep it (close reports)"}
        </button>
      </div>
      {act.error ? <p className="form-error">{act.error.message}</p> : null}
    </div>
  );
}
