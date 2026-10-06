import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Every secret-derived operation in one place. Keys are HKDF-derived per purpose from
 * RECORD_SIGNING_SECRET, so a record-URL signature can never be replayed as a session or a code hash.
 */

type Purpose = "record-url" | "buyer-session" | "handover-hash" | "handover-cipher" | "admin-session" | "invite-token";

const keyCache = new Map<Purpose, Buffer>();

function key(purpose: Purpose): Buffer {
  let k = keyCache.get(purpose);
  if (!k) {
    k = Buffer.from(hkdfSync("sha256", env().RECORD_SIGNING_SECRET, "procureai", purpose, 32));
    keyCache.set(purpose, k);
  }
  return k;
}

/** Test hook: env() may change between tests. */
export function resetCryptoKeys(): void {
  keyCache.clear();
}

function mac(purpose: Purpose, data: string): string {
  return createHmac("sha256", key(purpose)).update(data, "utf8").digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

// ── Vendor invite tokens ───────────────────────────────────────────────────

/**
 * A vendor's invite token is a keyed MAC of (request, label): unguessable, single-purpose, and the
 * DB stores only its sha256. The server can re-derive it to show the link to the buyer/admin again
 * (ProcureAI has no WhatsApp/SMS sending, so a person shares the link).
 */
export function inviteTokenFor(requestId: string, label: string): string {
  return mac("invite-token", `${requestId}:${label}`).slice(0, 32);
}

// ── Signed, unguessable record URLs ────────────────────────────────────────

/** "<orderId>.<mac>" — the order id alone is not enough to open a record. */
export function signRecordId(orderId: string): string {
  return `${orderId}.${mac("record-url", orderId).slice(0, 22)}`;
}

export function verifyRecordId(signed: string): string | null {
  const dot = signed.lastIndexOf(".");
  if (dot <= 0) return null;
  const id = signed.slice(0, dot);
  const sig = signed.slice(dot + 1);
  return safeEqual(sig, mac("record-url", id).slice(0, 22)) ? id : null;
}

// ── Buyer / admin sessions (signed cookie values) ──────────────────────────

export function signSession(kind: "buyer-session" | "admin-session", subject: string, ttlSeconds: number): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${subject}.${exp}`;
  return `${payload}.${mac(kind, payload)}`;
}

export function verifySession(kind: "buyer-session" | "admin-session", value: string | undefined): string | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [subject, expRaw, sig] = parts as [string, string, string];
  if (!safeEqual(sig, mac(kind, `${subject}.${expRaw}`))) return null;
  const exp = Number.parseInt(expRaw, 10);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
  return subject;
}

// ── Handover code: hashed for checking, encrypted so the buyer can see it again ──

export function generateHandoverCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function hashHandoverCode(orderId: string, code: string): string {
  return mac("handover-hash", `${orderId}:${code}`);
}

export function checkHandoverCode(orderId: string, candidate: string, storedHash: string): boolean {
  return safeEqual(hashHandoverCode(orderId, candidate), storedHash);
}

export function encryptHandoverCode(orderId: string, code: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key("handover-cipher"), iv);
  cipher.setAAD(Buffer.from(orderId, "utf8"));
  const ct = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ct].map((b) => b.toString("base64url")).join(".");
}

export function decryptHandoverCode(orderId: string, sealed: string): string {
  const [ivB, tagB, ctB] = sealed.split(".");
  if (!ivB || !tagB || !ctB) throw new Error("malformed handover code ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key("handover-cipher"), Buffer.from(ivB, "base64url"));
  decipher.setAAD(Buffer.from(orderId, "utf8"));
  decipher.setAuthTag(Buffer.from(tagB, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ctB, "base64url")), decipher.final()]).toString("utf8");
}
