/**
 * Money is integer kobo (bigint) everywhere on the server. No floats, ever.
 *
 * Kora sends naira as either a JSON number (22.5) or a decimal string ("100.00"), and wants naira
 * back with two decimals. Conversions here go through decimal *strings*, never `x * 100`.
 *
 * This file is isomorphic: the client imports formatNaira/formatKoboString to render, and does no
 * currency arithmetic of its own — every derived amount (split, shortfall, held) comes from the
 * server already computed.
 */

export type Kobo = bigint;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

const DECIMAL_RE = /^(-)?(\d{1,15})(?:\.(\d{1,6}))?$/;

/** "1,260,000.50" → 126000050n. Rejects more than 2 non-zero decimal places. */
export function decimalToKobo(input: string): Kobo {
  const s = input.trim().replace(/,/g, "");
  const m = DECIMAL_RE.exec(s);
  if (!m) throw new MoneyError(`not a decimal amount: ${JSON.stringify(input)}`);
  const [, neg, whole = "0", fracRaw = ""] = m;
  const extra = fracRaw.slice(2);
  if (extra.length > 0 && /[^0]/.test(extra)) {
    throw new MoneyError(`amount has sub-kobo precision: ${JSON.stringify(input)}`);
  }
  const frac = (fracRaw.slice(0, 2) + "00").slice(0, 2);
  const kobo = BigInt(whole) * 100n + BigInt(frac);
  return neg ? -kobo : kobo;
}

/**
 * A JSON number from Kora → kobo. String(n) is the shortest round-trip representation, which for
 * any JSON decimal literal of ≤15 significant digits is the literal itself, so no float arithmetic
 * touches the value.
 */
export function jsonNumberToKobo(n: number): Kobo {
  if (!Number.isFinite(n)) throw new MoneyError(`not a finite amount: ${n}`);
  const s = String(n);
  if (/e/i.test(s)) throw new MoneyError(`amount out of range: ${s}`);
  return decimalToKobo(s);
}

/** 126000050n → "1260000.50" (what Kora's request bodies expect, as a decimal literal). */
export function koboToNairaDecimal(kobo: Kobo): string {
  const neg = kobo < 0n;
  const abs = neg ? -kobo : kobo;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, "0");
  return `${neg ? "-" : ""}${whole.toString()}.${frac}`;
}

/** Naira integer → kobo, for literals like budgets typed as "₦1.5m" after parsing. */
export function nairaToKobo(naira: bigint): Kobo {
  return naira * 100n;
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * The one money formatter. "₦1,260,000" for whole naira, "₦1,234.57" otherwise.
 * Accepts bigint (server) or a kobo integer string (client, after JSON transport).
 */
export function formatNaira(kobo: Kobo | string): string {
  const k = typeof kobo === "string" ? parseKoboString(kobo) : kobo;
  const neg = k < 0n;
  const abs = neg ? -k : k;
  const whole = groupThousands((abs / 100n).toString());
  const rem = abs % 100n;
  const body = rem === 0n ? whole : `${whole}.${rem.toString().padStart(2, "0")}`;
  return `${neg ? "−" : ""}₦${body}`;
}

/** Kobo travels to the client as a string of digits (JSON has no bigint). */
export function parseKoboString(s: string): Kobo {
  if (!/^-?\d+$/.test(s)) throw new MoneyError(`not a kobo string: ${JSON.stringify(s)}`);
  return BigInt(s);
}

export function koboToString(kobo: Kobo): string {
  return kobo.toString();
}

/**
 * The 30/70 split. stage1 = floor(total × 30 / 100), stage2 = total − stage1, so the two stages
 * always sum to the total and no kobo is lost to rounding.
 */
export function splitStages(totalKobo: Kobo): { stage1: Kobo; stage2: Kobo } {
  if (totalKobo <= 0n) throw new MoneyError("order total must be positive");
  const stage1 = (totalKobo * 30n) / 100n; // bigint division truncates toward zero = floor for positives
  return { stage1, stage2: totalKobo - stage1 };
}

export function minKobo(a: Kobo, b: Kobo): Kobo {
  return a < b ? a : b;
}

export function maxKobo(a: Kobo, b: Kobo): Kobo {
  return a > b ? a : b;
}
