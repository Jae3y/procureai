import { del, get, put } from "@vercel/blob";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { log } from "@/lib/log";

/**
 * Where photos live. With BLOB_READ_WRITE_TOKEN set they go to Vercel Blob as PRIVATE files, so the database
 * stays small; without it they stay in Postgres as before. Either way a photo is only ever served through
 * ProcureAI's own routes, which do the access checks (evidence is for the order's buyer, vendor and admin only),
 * so no storage address is shown to anyone and the site's Content-Security-Policy needs no new host.
 */

export type PhotoFolder = "listings" | "evidence";
export type DecodedPhoto = { bytes: Uint8Array<ArrayBuffer>; type: string };
/** The columns a photo occupies on a row: bytes in Postgres, or a private Blob address. */
export type PhotoColumns = { photo: Uint8Array<ArrayBuffer> | null; photoType: string | null; photoUrl: string | null };

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export function blobEnabled(): boolean {
  return Boolean(env().BLOB_READ_WRITE_TOKEN);
}

/** Stores a checked photo and returns the columns to save. No photo → all null. */
export async function storePhoto(folder: PhotoFolder, photo: DecodedPhoto | null): Promise<PhotoColumns> {
  if (!photo) return { photo: null, photoType: null, photoUrl: null };
  if (!blobEnabled()) return { photo: photo.bytes, photoType: photo.type, photoUrl: null };
  const name = `${folder}/${randomBytes(16).toString("hex")}.${EXT[photo.type] ?? "img"}`;
  const r = await put(name, Buffer.from(photo.bytes), { access: "private", contentType: photo.type, token: env().BLOB_READ_WRITE_TOKEN, addRandomSuffix: false });
  return { photo: null, photoType: photo.type, photoUrl: r.url };
}

/** A photo's bytes for serving: from Blob when it has an address, otherwise from the row itself. */
export async function photoBody(row: { photo: Uint8Array | null; photoType: string | null; photoUrl: string | null }): Promise<{ body: BodyInit; type: string } | null> {
  if (!row.photoType) return null;
  if (row.photoUrl) {
    const r = await get(row.photoUrl, { access: "private", token: env().BLOB_READ_WRITE_TOKEN });
    if (!r?.stream) return null;
    return { body: r.stream, type: row.photoType };
  }
  return row.photo ? { body: Buffer.from(row.photo), type: row.photoType } : null;
}

/** Best effort: a file left behind costs a little storage, never a broken page. */
export async function removePhoto(url: string | null): Promise<void> {
  if (!url || !blobEnabled()) return;
  try {
    await del(url, { token: env().BLOB_READ_WRITE_TOKEN });
  } catch (err) {
    log.warn({ err: String(err) }, "could not delete a stored photo");
  }
}

/**
 * Moves photos saved before file storage was switched on out of Postgres, a few per background pass, so no single
 * run takes long. Each row is only changed if it still holds the same photo (a listing edited meanwhile is left for
 * the next pass, and the file just uploaded is deleted). A listing keeps its updatedAt, so the marketplace order
 * doesn't change. Safe to run any number of times.
 */
export async function moveDbPhotosToStorage(limit = 20): Promise<{ moved: number; skipped: number }> {
  if (!blobEnabled()) return { moved: 0, skipped: 0 };
  let moved = 0;
  let skipped = 0;
  const listings = await db().listing.findMany({ where: { photo: { not: null }, photoUrl: null }, select: { id: true }, take: limit });
  for (const { id } of listings) {
    const row = await db().listing.findUnique({ where: { id }, select: { photo: true, photoType: true, updatedAt: true } });
    if (!row?.photo || !row.photoType) continue;
    const stored = await storePhoto("listings", { bytes: new Uint8Array(row.photo), type: row.photoType });
    const { count } = await db().listing.updateMany({
      where: { id, photoUrl: null, updatedAt: row.updatedAt },
      data: { photo: null, photoUrl: stored.photoUrl, updatedAt: row.updatedAt },
    });
    if (count === 1) moved += 1;
    else {
      skipped += 1;
      await removePhoto(stored.photoUrl);
    }
  }
  const room = Math.max(0, limit - listings.length);
  const evidence = room > 0 ? await db().orderEvidence.findMany({ where: { photo: { not: null }, photoUrl: null }, select: { id: true }, take: room }) : [];
  for (const { id } of evidence) {
    const row = await db().orderEvidence.findUnique({ where: { id }, select: { photo: true, photoType: true } });
    if (!row?.photo || !row.photoType) continue;
    const stored = await storePhoto("evidence", { bytes: new Uint8Array(row.photo), type: row.photoType });
    const { count } = await db().orderEvidence.updateMany({ where: { id, photoUrl: null }, data: { photo: null, photoUrl: stored.photoUrl } });
    if (count === 1) moved += 1;
    else {
      skipped += 1;
      await removePhoto(stored.photoUrl);
    }
  }
  if (moved || skipped) log.info({ moved, skipped }, "moved stored photos out of the database");
  return { moved, skipped };
}
