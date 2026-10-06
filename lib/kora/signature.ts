import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Kora signs webhooks with HMAC-SHA256 over ONLY the `data` object, keyed with the secret key,
 * delivered hex-encoded in `x-korapay-signature` (docs/kora-snapshots/webhooks.md).
 *
 * Kora's own Node sample hashes `JSON.stringify(req.body.data)` — a re-serialisation. Re-serialising
 * is fragile (an amount sent as 150.00 re-serialises as 150; unicode and slash escaping can differ),
 * so we first hash the exact bytes of the `data` value as received, and fall back to the documented
 * re-serialisation. Either canonical form requires the secret key; both comparisons are constant-time.
 */

export type SignatureCheck =
  | { valid: true; method: "raw-span" | "reserialized" }
  | { valid: false; reason: "missing-header" | "malformed-header" | "no-data-object" | "mismatch" };

export function hmacHex(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

/**
 * Returns the exact source text of the top-level "data" value in a JSON object, or null.
 * A minimal scanner: tracks string/escape state and nesting depth; never evaluates the JSON.
 */
export function extractRawDataSpan(raw: string): string | null {
  let i = 0;
  const n = raw.length;
  const skipWs = () => {
    while (i < n && /\s/.test(raw[i] ?? "")) i++;
  };
  const readString = (): string | null => {
    if (raw[i] !== '"') return null;
    const start = i;
    i++;
    while (i < n) {
      const c = raw[i];
      if (c === "\\") i += 2;
      else if (c === '"') {
        i++;
        return raw.slice(start, i);
      } else i++;
    }
    return null;
  };
  const skipValue = (): boolean => {
    skipWs();
    const c = raw[i];
    if (c === '"') return readString() !== null;
    if (c === "{" || c === "[") {
      let depth = 0;
      while (i < n) {
        const ch = raw[i];
        if (ch === '"') {
          if (readString() === null) return false;
          continue;
        }
        if (ch === "{" || ch === "[") depth++;
        else if (ch === "}" || ch === "]") {
          depth--;
          if (depth === 0) {
            i++;
            return true;
          }
        }
        i++;
      }
      return false;
    }
    const start = i;
    while (i < n && !/[,}\]\s]/.test(raw[i] ?? "")) i++;
    return i > start; // a key with no value (a truncated body) is not a value
  };

  skipWs();
  if (raw[i] !== "{") return null;
  i++;
  for (;;) {
    skipWs();
    if (raw[i] === "}") return null;
    const keyLiteral = readString();
    if (keyLiteral === null) return null;
    skipWs();
    if (raw[i] !== ":") return null;
    i++;
    skipWs();
    const valueStart = i;
    if (!skipValue()) return null;
    if (keyLiteral === '"data"') return raw.slice(valueStart, i);
    skipWs();
    if (raw[i] === ",") {
      i++;
      continue;
    }
    return null;
  }
}

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) {
    // Compare against itself so timing does not reveal the length mismatch path.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export function verifyKoraSignature(rawBody: string, header: string | null, secret: string): SignatureCheck {
  if (!header) return { valid: false, reason: "missing-header" };
  const sig = header.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sig)) return { valid: false, reason: "malformed-header" };

  const span = extractRawDataSpan(rawBody);
  if (span === null) return { valid: false, reason: "no-data-object" };

  const rawOk = safeEqualHex(hmacHex(span, secret), sig);

  let reserializedOk = false;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (parsed && typeof parsed === "object" && "data" in parsed) {
      reserializedOk = safeEqualHex(hmacHex(JSON.stringify((parsed as { data: unknown }).data), secret), sig);
    }
  } catch {
    reserializedOk = false; // malformed JSON can only match via the raw span, already computed
  }

  if (rawOk) return { valid: true, method: "raw-span" };
  if (reserializedOk) return { valid: true, method: "reserialized" };
  return { valid: false, reason: "mismatch" };
}

/** Used by tests and the admin "replay" control to sign a body exactly as Kora does. */
export function signLikeKora(data: unknown, secret: string): string {
  return hmacHex(JSON.stringify(data), secret);
}
