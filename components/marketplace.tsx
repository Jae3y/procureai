"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field } from "./auth-forms";
import { shrinkPhoto, type PhotoPayload } from "./evidence";
import { useAction, type ActionError } from "./hooks";
import { Spinner } from "./ui";

function issueFor(error: ActionError | null, path: string): string | undefined {
  const issues = (error?.details as { issues?: Array<{ path: string; message: string }> } | undefined)?.issues ?? [];
  return issues.find((i) => i.path === path)?.message;
}
function hasIssues(error: ActionError | null): boolean {
  return Boolean((error?.details as { issues?: unknown[] } | undefined)?.issues?.length);
}

/** A date a week from today, in Lagos, as YYYY-MM-DD: a sensible default "needed by". */
function inAWeek(): string {
  const d = new Date(Date.now() + 7 * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** "Request from this seller": quantity, budget, date. Opens a protected purchase and goes straight to it. */
export function ListingRequestForm({ listingId, minOrder, unit, priceKobo }: { listingId: string; minOrder: number; unit: string; priceKobo: string | null }) {
  const router = useRouter();
  const [quantity, setQuantity] = useState(String(minOrder));
  const unitPrice = priceKobo ? BigInt(priceKobo) : null;
  const suggested = (q: string) => {
    const n = Number(q.replace(/,/g, ""));
    if (!unitPrice || !Number.isInteger(n) || n <= 0) return "";
    return ((unitPrice * BigInt(n)) / 100n).toLocaleString("en-NG");
  };
  const [budget, setBudget] = useState(suggested(String(minOrder)));
  const [budgetTouched, setBudgetTouched] = useState(false);
  const [deadline, setDeadline] = useState(inAWeek());
  const [alsoAskOthers, setAlsoAskOthers] = useState(true);
  const send = useAction<{ quantity: string; budget: string; deadline: string; alsoAskOthers: boolean }, { id: string }>(`/api/market/listings/${listingId}/request`);
  return (
    <form
      noValidate
      className="account-form"
      onSubmit={(e) => {
        e.preventDefault();
        void send.run({ quantity: quantity.replace(/,/g, ""), budget, deadline, alsoAskOthers }).then((r) => {
          if (r.ok) router.push(`/buy/${r.data.id}`);
        });
      }}
    >
      <Field
        id="mk-qty"
        label={`How many (${unit})`}
        inputMode="numeric"
        value={quantity}
        onChange={(e) => {
          setQuantity(e.target.value);
          if (!budgetTouched) setBudget(suggested(e.target.value));
        }}
        error={issueFor(send.error, "quantity")}
      />
      <Field
        id="mk-budget"
        label="Your budget for the whole order (₦)"
        inputMode="decimal"
        placeholder="e.g. 250,000"
        value={budget}
        onChange={(e) => {
          setBudgetTouched(true);
          setBudget(e.target.value);
        }}
        error={issueFor(send.error, "budget")}
      />
      <Field id="mk-date" label="Needed by" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} error={issueFor(send.error, "deadline")} />
      <label className="check">
        <input type="checkbox" checked={alsoAskOthers} onChange={(e) => setAlsoAskOthers(e.target.checked)} />
        <span>Also ask other sellers of this, so I can compare prices</span>
      </label>
      <div>
        <button type="submit" className="btn" disabled={send.pending}>
          {send.pending ? <Spinner label="Sending your request" /> : "Request from this seller"}
        </button>
      </div>
      <div aria-live="polite">{send.error && !hasIssues(send.error) ? <p className="form-error">{send.error.message}</p> : null}</div>
    </form>
  );
}

export type OwnListing = {
  id: string;
  title: string;
  description: string;
  category: string;
  price: string;
  unit: string;
  minOrder: number;
  status: "ACTIVE" | "PAUSED";
  hasPhoto: boolean;
};

type Draft = { title: string; description: string; category: string; price: string; unit: string; minOrder: string };
const EMPTY: Draft = { title: "", description: "", category: "", price: "", unit: "piece", minOrder: "1" };

function ListingForm({ categories, initial, listingId, onDone }: { categories: readonly string[]; initial: Draft; listingId: string | null; onDone: () => void }) {
  const router = useRouter();
  const [f, setF] = useState<Draft>(initial);
  const [photo, setPhoto] = useState<PhotoPayload | null>(null);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const send = useAction<Record<string, unknown>>(listingId ? `/api/vendor/listings/${listingId}` : "/api/vendor/listings");
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <form
      noValidate
      className="account-form mk-form"
      onSubmit={(e) => {
        e.preventDefault();
        void send.run({ ...f, minOrder: f.minOrder.replace(/,/g, ""), photo }).then((r) => {
          if (r.ok) {
            router.refresh();
            onDone();
          }
        });
      }}
    >
      <Field id="lf-title" label="Product name" placeholder="e.g. Branded round-neck T-shirt" value={f.title} onChange={set("title")} error={issueFor(send.error, "title")} />
      <div className="field">
        <label htmlFor="lf-category">Category</label>
        <select id="lf-category" className="input" value={f.category} onChange={set("category")} aria-invalid={Boolean(issueFor(send.error, "category"))}>
          <option value="">Choose a category</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {issueFor(send.error, "category") ? <span className="form-error">{issueFor(send.error, "category")}</span> : null}
      </div>
      <div className="field-row">
        <Field id="lf-price" label="Price (₦), or leave empty" inputMode="decimal" placeholder="4,200" value={f.price} onChange={set("price")} error={issueFor(send.error, "price")} />
        <Field id="lf-unit" label="Per" placeholder="piece, carton, bag" value={f.unit} onChange={set("unit")} error={issueFor(send.error, "unit")} />
      </div>
      <Field id="lf-min" label="Minimum order" inputMode="numeric" value={f.minOrder} onChange={set("minOrder")} error={issueFor(send.error, "minOrder")} />
      <div className="field">
        <label htmlFor="lf-desc">Description</label>
        <textarea id="lf-desc" className="input" rows={4} placeholder="Sizes, colours, materials, how fast you can deliver…" value={f.description} onChange={set("description")} />
      </div>
      <div className="field">
        <label htmlFor="lf-photo">Photo</label>
        <input
          id="lf-photo"
          type="file"
          accept="image/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setPreparing(true);
            setPhotoNote(null);
            void shrinkPhoto(file)
              .then((p) => {
                setPhoto(p);
                setPhotoNote("Photo ready.");
              })
              .catch((err: unknown) => setPhotoNote(err instanceof Error ? err.message : "That photo couldn't be used."))
              .finally(() => setPreparing(false));
          }}
        />
        {preparing ? <Spinner label="Preparing photo" /> : photoNote ? <span className="note" style={{ margin: 0, fontSize: 14 }}>{photoNote}</span> : null}
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button type="submit" className="btn-2" disabled={send.pending || preparing}>
          {send.pending ? <Spinner label="Saving" /> : listingId ? "Save changes" : "Add to marketplace"}
        </button>
        <button type="button" className="btn-text" onClick={onDone}>
          Cancel
        </button>
      </div>
      {send.error && !hasIssues(send.error) ? <p className="form-error">{send.error.message}</p> : null}
    </form>
  );
}

/** The seller's products on the vendor dashboard: add, edit, pause, remove. */
export function ListingsManager({ listings, categories }: { listings: OwnListing[]; categories: readonly string[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const change = async (id: string, next: "ACTIVE" | "PAUSED" | "REMOVED") => {
    setBusy(id);
    const res = await fetch(`/api/vendor/listings/${id}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: next }) });
    setBusy(null);
    if (res.ok) router.refresh();
  };
  return (
    <div className="account-block">
      <div className="account-block-head">
        <h2>Your products on the marketplace</h2>
      </div>
      <p className="note" style={{ marginTop: 0 }}>
        Buyers browse these at <a href="/market">procureai.com.ng/market</a> and request straight from you. Listing is free.
      </p>
      {listings.length > 0 ? (
        <ul className="account-list">
          {listings.map((l) =>
            editing === l.id ? (
              <li key={l.id} style={{ display: "block" }}>
                <ListingForm
                  categories={categories}
                  listingId={l.id}
                  initial={{ title: l.title, description: l.description, category: l.category, price: l.price, unit: l.unit, minOrder: String(l.minOrder) }}
                  onDone={() => setEditing(null)}
                />
              </li>
            ) : (
              <li key={l.id}>
                <div>
                  <strong>
                    <a href={`/market/${l.id}`}>{l.title}</a>
                  </strong>
                  <div className="note" style={{ fontSize: 15 }}>
                    {l.price ? `₦${l.price} / ${l.unit}` : "Price on request"} · {l.status === "ACTIVE" ? "Showing" : "Paused"}
                    {l.hasPhoto ? "" : " · no photo yet"}
                  </div>
                </div>
                <span style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                  <button type="button" className="btn-text" onClick={() => setEditing(l.id)}>
                    Edit
                  </button>
                  <button type="button" className="btn-text" disabled={busy === l.id} onClick={() => void change(l.id, l.status === "ACTIVE" ? "PAUSED" : "ACTIVE")}>
                    {l.status === "ACTIVE" ? "Pause" : "Show again"}
                  </button>
                  <button
                    type="button"
                    className="btn-text"
                    disabled={busy === l.id}
                    onClick={() => {
                      if (window.confirm(`Remove "${l.title}" from the marketplace?`)) void change(l.id, "REMOVED");
                    }}
                  >
                    Remove
                  </button>
                </span>
              </li>
            ),
          )}
        </ul>
      ) : null}
      {editing === "new" ? (
        <ListingForm categories={categories} listingId={null} initial={EMPTY} onDone={() => setEditing(null)} />
      ) : (
        <button type="button" className="btn-2" style={{ marginTop: 16 }} onClick={() => setEditing("new")}>
          Add a product
        </button>
      )}
    </div>
  );
}
