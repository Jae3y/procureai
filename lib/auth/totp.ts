import { createHmac, randomBytes } from "node:crypto";
import { safeEqual } from "@/lib/crypto";

/**
 * Time-based one-time codes (RFC 6238, the scheme Google Authenticator, Authy and 1Password use):
 * HMAC-SHA1, 30-second steps, 6 digits. One step either side is accepted for clock drift, and a
 * code's step is remembered so the same code can't be used twice.
 */

const STEP_SECONDS = 30;
const DIGITS = 6;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const binary = (((hmac[offset] ?? 0) & 0x7f) << 24) | ((hmac[offset + 1] ?? 0) << 16) | ((hmac[offset + 2] ?? 0) << 8) | (hmac[offset + 3] ?? 0);
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

export function currentStep(now = Date.now()): number {
  return Math.floor(now / 1000 / STEP_SECONDS);
}

/** The step the code belongs to, or null. A step at or before `lastUsedStep` is refused (no replay). */
export function verifyTotp(secret: string, code: string, lastUsedStep: number | null, now = Date.now()): number | null {
  const clean = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(clean)) return null;
  const here = currentStep(now);
  for (const step of [here - 1, here, here + 1]) {
    if (lastUsedStep !== null && step <= lastUsedStep) continue;
    if (safeEqual(totpCode(secret, step), clean)) return step;
  }
  return null;
}

export function otpauthUrl(secret: string, email: string): string {
  const label = encodeURIComponent(`ProcureAI:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=ProcureAI&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

/** Ten single-use recovery codes, shown once. Only their hashes are stored. */
export function newRecoveryCodes(): string[] {
  return Array.from({ length: 10 }, () => {
    const raw = base32Encode(randomBytes(6)).slice(0, 10).toLowerCase();
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

export function normalizeRecoveryCode(code: string): string {
  const clean = code.toLowerCase().replace(/[^a-z2-7]/g, "");
  return `${clean.slice(0, 5)}-${clean.slice(5, 10)}`;
}
