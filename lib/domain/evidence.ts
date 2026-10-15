import { DomainError } from "./errors";

/** Evidence attached to an order: a short note and an optional photo, checked before anything is stored. */

export const EVIDENCE_NOTE_MAX = 500;
export const EVIDENCE_PHOTO_MAX_BYTES = 700 * 1024;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type EvidenceInput = { note: string; photo?: { type: string; base64: string } | null };

export function decodePhoto(photo: EvidenceInput["photo"]): { bytes: Uint8Array<ArrayBuffer>; type: string } | null {
  if (!photo) return null;
  if (!(PHOTO_TYPES as readonly string[]).includes(photo.type)) throw new DomainError("photo_type", "Photos must be JPEG, PNG or WebP.", 400);
  const buf = Buffer.from(photo.base64, "base64");
  if (buf.length === 0) throw new DomainError("photo_empty", "That photo couldn't be read.", 400);
  if (buf.length > EVIDENCE_PHOTO_MAX_BYTES) throw new DomainError("photo_too_big", "That photo is too large (700 KB at most).", 400);
  return { bytes: new Uint8Array(buf), type: photo.type };
}

export function cleanNote(raw: string): string {
  const note = raw.trim();
  if (!note) throw new DomainError("note_empty", "Add a short note.", 400);
  if (note.length > EVIDENCE_NOTE_MAX) throw new DomainError("note_too_long", `Notes are at most ${EVIDENCE_NOTE_MAX} characters.`, 400);
  return note;
}

