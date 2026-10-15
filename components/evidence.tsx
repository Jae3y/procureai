"use client";

import { useRef, useState } from "react";
import type { OrderView } from "@/lib/views/order-view";
import { useAction } from "./hooks";
import { Spinner } from "./ui";

export type PhotoPayload = { type: string; base64: string };

const MAX_BYTES = 700 * 1024;

/** Shrinks a phone photo (often 3–8 MB) to a JPEG under 700 KB before it leaves the device. */
export async function shrinkPhoto(file: File): Promise<PhotoPayload> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("That file isn't a photo we can read."));
      el.src = url;
    });
    for (const [side, quality] of [
      [1280, 0.72],
      [1024, 0.6],
      [800, 0.5],
    ] as const) {
      const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("This browser can't prepare photos.");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      if (base64.length * 0.75 <= MAX_BYTES) return { type: "image/jpeg", base64 };
    }
    throw new Error("That photo is too large even after shrinking it.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A note plus an optional photo, posted to `url` as { [noteField], photo }. */
export function EvidenceForm({
  url,
  noteField = "note",
  noteLabel,
  placeholder,
  submitLabel,
  busyLabel,
  minNote = 1,
  onDone,
  onCancel,
}: {
  url: string;
  noteField?: "note" | "reason";
  noteLabel: string;
  placeholder?: string;
  submitLabel: string;
  busyLabel: string;
  minNote?: number;
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<PhotoPayload | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [sent, setSent] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const send = useAction<Record<string, unknown>>(url);
  const id = `ev-${url}`;

  return (
    <form
      className="evidence-form"
      onSubmit={(e) => {
        e.preventDefault();
        void send.run({ [noteField]: note.trim(), photo }).then((r) => {
          if (!r.ok) return;
          setSent(true);
          setNote("");
          setPhoto(null);
          setPreview(null);
          onDone?.();
        });
      }}
    >
      <div className="field">
        <label htmlFor={id}>{noteLabel}</label>
        <textarea id={id} className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder={placeholder} rows={3} />
      </div>
      <div className="evidence-photo">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="sr-only"
          id={`${id}-photo`}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setPhotoError(null);
            setPreparing(true);
            void shrinkPhoto(file)
              .then((p) => {
                setPhoto(p);
                setPreview(`data:${p.type};base64,${p.base64}`);
              })
              .catch((err: unknown) => setPhotoError(err instanceof Error ? err.message : "That photo couldn't be used."))
              .finally(() => setPreparing(false));
          }}
        />
        <label htmlFor={`${id}-photo`} className="btn-2 evidence-photo-btn">
          {preparing ? <Spinner label="Preparing photo" /> : photo ? "Change photo" : "Add a photo"}
        </label>
        {preview ? (
          <span className="evidence-thumb">
            <img src={preview} alt="Photo to send" />
            <button
              type="button"
              className="btn-text"
              onClick={() => {
                setPhoto(null);
                setPreview(null);
                if (fileRef.current) fileRef.current.value = "";
              }}
            >
              Remove
            </button>
          </span>
        ) : null}
      </div>
      {photoError ? <p className="form-error">{photoError}</p> : null}
      <div className="evidence-actions">
        <button type="submit" className="btn btn-sm" disabled={send.pending || preparing || note.trim().length < minNote}>
          {send.pending ? <Spinner label={busyLabel} /> : submitLabel}
        </button>
        {onCancel ? (
          <button type="button" className="btn-text" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
      <div aria-live="polite">
        {send.error ? <p className="form-error">{send.error.message}</p> : sent ? <p className="note" style={{ fontSize: 14 }}>Sent.</p> : null}
      </div>
    </form>
  );
}

/** Proof of delivery and dispute evidence, as each side gave it. */
export function EvidenceList({ items, title }: { items: OrderView["track"]["evidence"]; title?: string }) {
  if (!items.length) return null;
  return (
    <div className="evidence-list">
      {title ? <div className="label" style={{ marginBottom: 12 }}>{title}</div> : null}
      <ol>
        {items.map((ev) => (
          <li key={ev.id} className={`evidence-item ${ev.party}`}>
            <div className="msg-meta">
              <strong>{ev.who}</strong> · {ev.kind === "delivery" ? "proof of delivery" : ev.party === "buyer" ? "buyer's side" : "vendor's side"} · <time>{ev.when}</time>
            </div>
            <div className="msg-text">{ev.note}</div>
            {ev.photoUrl ? (
              <a href={ev.photoUrl} target="_blank" rel="noreferrer" className="evidence-photo-link">
                <img src={ev.photoUrl} alt={`Photo from ${ev.who}`} loading="lazy" />
              </a>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
