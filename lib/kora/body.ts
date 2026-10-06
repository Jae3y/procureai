import { koboToNairaDecimal, type Kobo } from "@/lib/money";

/**
 * Kora wants naira as a JSON number with two decimals. Building that number with `kobo / 100`
 * would put a float on the money path, so amounts are wrapped and spliced into the JSON text as
 * exact decimal literals instead.
 */
export class NairaAmount {
  readonly decimal: string;
  constructor(readonly kobo: Kobo) {
    if (kobo < 0n) throw new RangeError("Kora amounts cannot be negative");
    this.decimal = koboToNairaDecimal(kobo);
  }
}

const SENTINEL = "__kora_naira__";
const SENTINEL_RE = new RegExp(`"${SENTINEL}(\\d+\\.\\d{2})${SENTINEL}"`, "g");

export function serializeKoraBody(body: unknown): string {
  const text = JSON.stringify(body, (_key, value: unknown) => {
    if (value instanceof NairaAmount) return `${SENTINEL}${value.decimal}${SENTINEL}`;
    if (typeof value === "bigint") throw new TypeError("wrap bigint amounts in NairaAmount before sending to Kora");
    return value;
  });
  return text.replace(SENTINEL_RE, "$1");
}
