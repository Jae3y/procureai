import { describe, expect, it } from "vitest";
import { buyerProtectionFee, foundingFeeHolidayEnds, plusSavingOnOrder, sellerFee } from "@/lib/domain/fees";

const naira = (n: number) => BigInt(n) * 100n;

describe("buyer protection fee: bands, no cap", () => {
  it.each([
    [20_000, 800],
    [50_000, 2_000],
    [100_000, 4_000],
    [300_000, 9_000],
    [1_000_000, 26_500],
    [5_000_000, 86_500],
    [10_000_000, 161_500],
    [20_000_000, 261_500],
  ])("₦%i order costs ₦%i", (order, fee) => {
    expect(buyerProtectionFee(naira(order))).toBe(naira(fee));
  });

  it("has a ₦300 minimum, and nothing for a zero order", () => {
    expect(buyerProtectionFee(naira(3_334))).toBe(naira(300));
    expect(buyerProtectionFee(0n)).toBe(0n);
  });

  it("never falls as the order grows (no cliffs between bands), and the rate falls for bigger orders", () => {
    let prev = 0n;
    let prevRate = 1;
    for (const order of [4_000, 9_999, 10_000, 99_999, 100_001, 999_999, 1_000_001, 9_999_999, 10_000_001, 50_000_000]) {
      const fee = buyerProtectionFee(naira(order));
      expect(fee).toBeGreaterThanOrEqual(prev);
      const rate = Number(fee) / Number(naira(order));
      expect(rate).toBeLessThanOrEqual(prevRate + 1e-4); // whole-naira rounding only
      prev = fee;
      prevRate = rate;
    }
  });
});

describe("ProcureAI Plus", () => {
  it("halves only the first band, so the saving never passes ₦2,000 an order", () => {
    expect(buyerProtectionFee(naira(100_000), { plus: true })).toBe(naira(2_000));
    expect(buyerProtectionFee(naira(1_000_000), { plus: true })).toBe(naira(24_500));
    for (const order of [20_000, 100_000, 500_000, 5_000_000, 50_000_000]) {
      expect(plusSavingOnOrder(naira(order))).toBeLessThanOrEqual(naira(2_000));
    }
  });

  it("so the ₦3,000 monthly price is covered by two ordinary orders a month", () => {
    expect(plusSavingOnOrder(naira(250_000)) * 2n).toBeLessThanOrEqual(naira(3_000) * 2n);
    // A member never costs us more than ₦2,000 an order against a free user, so a heavy buyer doing 10 orders costs at most ₦20,000.
    expect(plusSavingOnOrder(naira(2_000_000)) * 10n).toBeLessThanOrEqual(naira(20_000));
  });
});

describe("seller fee", () => {
  it("is 2% of the payout, rounded to the naira", () => {
    expect(sellerFee(naira(250_000))).toBe(naira(5_000));
    expect(sellerFee(naira(1_234))).toBe(naira(25));
  });

  it("is nothing during a founding seller's first six months", () => {
    const joined = new Date("2026-11-12T00:00:00Z");
    const until = foundingFeeHolidayEnds(joined);
    expect(until.toISOString().slice(0, 10)).toBe("2027-05-12");
    expect(sellerFee(naira(250_000), { foundingUntil: until, now: new Date("2027-01-01T00:00:00Z") })).toBe(0n);
    expect(sellerFee(naira(250_000), { foundingUntil: until, now: new Date("2027-06-01T00:00:00Z") })).toBe(naira(5_000));
  });
});

describe("the fees still make money under the worst provider costs we found", () => {
  // Worst case from public figures: collect at 1.5% capped ₦2,000, plus about ₦100 for the two payouts. Unconfirmed; see the plan.
  const cost = (order: number) => {
    const collect = Math.min(order * 0.015, 2_000);
    return collect + 100;
  };
  it.each([3_334, 10_000, 50_000, 300_000, 1_000_000, 10_000_000])("on a ₦%i order", (order) => {
    const earned = Number(buyerProtectionFee(naira(order)) + sellerFee(naira(order))) / 100;
    expect(earned).toBeGreaterThan(cost(order));
  });
});
