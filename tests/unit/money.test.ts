import { describe, expect, it } from "vitest";
import { serializeKoraBody, NairaAmount } from "@/lib/kora/body";
import {
  decimalToKobo,
  formatNaira,
  jsonNumberToKobo,
  koboToNairaDecimal,
  MoneyError,
  parseKoboString,
  splitStages,
} from "@/lib/money";

describe("money split — 30/70, no kobo lost", () => {
  it("the demo order: ₦1,260,000 → ₦378,000 + ₦882,000", () => {
    expect(splitStages(126_000_000n)).toEqual({ stage1: 37_800_000n, stage2: 88_200_000n });
  });

  it.each([1n, 2n, 3n, 7n, 99n, 101n, 333n, 1_000_001n, 123_456_789n, 999_999_999_999n])(
    "odd total %s kobo: stages sum exactly and stage1 = floor(30%%)",
    (total) => {
      const { stage1, stage2 } = splitStages(total);
      expect(stage1 + stage2).toBe(total);
      expect(stage1).toBe((total * 30n) / 100n);
      expect(stage1 * 100n <= total * 30n).toBe(true);
      expect((stage1 + 1n) * 100n > total * 30n).toBe(true);
    },
  );

  it("exhaustively for every total 1..5000 kobo", () => {
    for (let t = 1n; t <= 5000n; t++) {
      const { stage1, stage2 } = splitStages(t);
      expect(stage1 + stage2).toBe(t);
      expect(stage2 >= stage1).toBe(true);
    }
  });

  it("rejects non-positive totals", () => {
    expect(() => splitStages(0n)).toThrow(MoneyError);
  });
});

describe("decimal ↔ kobo, no floats", () => {
  it.each([
    ["100", 10_000n],
    ["100.00", 10_000n],
    ["22.5", 2_250n],
    ["1,260,000", 126_000_000n],
    ["1031741.79", 103_174_179n],
    ["0.01", 1n],
    ["2.500", 250n],
  ])("%s → %s", (s, k) => expect(decimalToKobo(s)).toBe(k));

  it("rejects sub-kobo precision and junk", () => {
    expect(() => decimalToKobo("1.001")).toThrow(MoneyError);
    expect(() => decimalToKobo("1e5")).toThrow(MoneyError);
    expect(() => decimalToKobo("₦100")).toThrow(MoneyError);
  });

  it("JSON numbers from Kora convert exactly (0.1 + 0.2 style values)", () => {
    expect(jsonNumberToKobo(22.5)).toBe(2_250n);
    expect(jsonNumberToKobo(150.99)).toBe(15_099n);
    expect(jsonNumberToKobo(1.69)).toBe(169n);
    expect(jsonNumberToKobo(1031641.79)).toBe(103_164_179n);
    expect(() => jsonNumberToKobo(1e21)).toThrow(MoneyError);
    expect(() => jsonNumberToKobo(Number.NaN)).toThrow(MoneyError);
  });

  it("formats to Kora decimals", () => {
    expect(koboToNairaDecimal(37_800_000n)).toBe("378000.00");
    expect(koboToNairaDecimal(123_457n)).toBe("1234.57");
    expect(koboToNairaDecimal(5n)).toBe("0.05");
  });

  it("serializes Kora request bodies with exact decimal literals", () => {
    const text = serializeKoraBody({ amount: new NairaAmount(123_457n), destination: { amount: new NairaAmount(37_800_000n) } });
    expect(text).toBe('{"amount":1234.57,"destination":{"amount":378000.00}}');
    expect(() => serializeKoraBody({ amount: 5n })).toThrow(/NairaAmount/);
  });
});

describe("the one money formatter", () => {
  it.each([
    [126_000_000n, "₦1,260,000"],
    [37_800_000n, "₦378,000"],
    [6_000_000n, "₦60,000"],
    [0n, "₦0"],
    [123_457n, "₦1,234.57"],
    [5n, "₦0.05"],
    [-6_000_000n, "−₦60,000"],
  ])("%s kobo → %s", (k, s) => {
    expect(formatNaira(k)).toBe(s);
    expect(formatNaira(k.toString())).toBe(s);
  });

  it("rejects non-integer kobo strings from the wire", () => {
    expect(() => parseKoboString("12.5")).toThrow(MoneyError);
  });
});
