import { describe, expect, it } from "vitest";
import { MAX_PARTS, paidForStage, payoutReference, splitIntoParts, stageIsPaid } from "@/lib/domain/payout-parts";

const naira = (n: number) => BigInt(n) * 100n;
const MAX = naira(10_000_000); // Kora's per-transfer maximum

describe("splitting a stage into transfers", () => {
  it("keeps a stage within the maximum as one payout", () => {
    expect(splitIntoParts(naira(10_000_000), MAX)).toEqual([naira(10_000_000)]);
    expect(splitIntoParts(naira(3_000), MAX)).toEqual([naira(3_000)]);
  });

  it("splits a ₦100M order: 30% is 3 transfers, 70% is 7", () => {
    expect(splitIntoParts(naira(30_000_000), MAX)).toEqual([naira(10_000_000), naira(10_000_000), naira(10_000_000)]);
    expect(splitIntoParts(naira(70_000_000), MAX)).toHaveLength(7);
  });

  it("uses the fewest parts, each within the maximum, and the parts always add up to the stage exactly", () => {
    for (const stage of [10_000_001n, 12_345_678_91n, 70_000_000_01n, 99_999_999_99n, 1n * 3_000_000_000n + 7n]) {
      const parts = splitIntoParts(stage, MAX);
      expect(parts.reduce((a, p) => a + p, 0n)).toBe(stage);
      expect(parts.every((p) => p <= MAX && p > 0n)).toBe(true);
      expect(parts.length).toBe(Number((stage + MAX - 1n) / MAX));
      const spread = parts.reduce((m, p) => (p > m ? p : m), 0n) - parts.reduce((m, p) => (p < m ? p : m), parts[0] ?? 0n);
      expect(spread <= 1n).toBe(true); // as equal as whole kobo allow
    }
  });

  it("is the same every time it is asked (retries rely on this)", () => {
    expect(splitIntoParts(naira(70_000_001), MAX)).toEqual(splitIntoParts(naira(70_000_001), MAX));
  });

  it("refuses a stage that would need more parts than the database allows", () => {
    expect(() => splitIntoParts(MAX * BigInt(MAX_PARTS + 1), MAX)).toThrow();
  });
});

describe("references", () => {
  it("keep the original format for part 1, attempt 1, and stay distinct for every part and attempt", () => {
    expect(payoutReference("ord1", "S1", 1, 1)).toBe("PO-ord1-S1");
    expect(payoutReference("ord1", "S1", 1, 2)).toBe("PO-ord1-S1-R2");
    expect(payoutReference("ord1", "S2", 3, 1)).toBe("PO-ord1-S2-P3");
    expect(payoutReference("ord1", "S2", 3, 2)).toBe("PO-ord1-S2-P3-R2");
    const all = new Set(["S1", "S2"].flatMap((s) => [1, 2, 3].flatMap((part) => [1, 2].map((a) => payoutReference("o", s as "S1" | "S2", part, a)))));
    expect(all.size).toBe(12);
  });
});

describe("a stage is paid only when every part has landed", () => {
  const rows = [
    { stage: "STAGE_1", status: "SUCCESS", amountKobo: naira(10_000_000) },
    { stage: "STAGE_1", status: "PENDING", amountKobo: naira(10_000_000) },
    { stage: "STAGE_1", status: "FAILED", amountKobo: naira(10_000_000) },
    { stage: "STAGE_2", status: "SUCCESS", amountKobo: naira(5_000_000) },
  ];
  it("sums only successful parts of that stage", () => {
    expect(paidForStage(rows, "STAGE_1")).toBe(naira(10_000_000));
    expect(stageIsPaid(rows, "STAGE_1", naira(30_000_000))).toBe(false);
    expect(stageIsPaid(rows, "STAGE_2", naira(5_000_000))).toBe(true);
  });
});
