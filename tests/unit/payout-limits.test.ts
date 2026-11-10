import { describe, expect, it } from "vitest";
import { assertPayableInStages } from "@/lib/domain/approve";

/**
 * Each stage is one payout, and Kora pays out ₦1,000 to ₦10,000,000 per transfer. The smallest order
 * whose 30% reaches ₦1,000 is ₦3,333.34; the largest whose 70% stays within ₦10m is ₦14,285,714.28.
 */
describe("orders must be payable in two stages", () => {
  it("accepts the smallest and largest payable orders", () => {
    expect(() => assertPayableInStages(333_334n)).not.toThrow();
    expect(() => assertPayableInStages(1_428_571_428n)).not.toThrow();
  });

  it("refuses an order whose 30% would be under the ₦1,000 payout minimum", () => {
    expect(() => assertPayableInStages(333_333n)).toThrowError(expect.objectContaining({ code: "order_too_small" }));
  });

  it("refuses an order whose 70% would be over the ₦10,000,000 payout maximum", () => {
    expect(() => assertPayableInStages(1_428_571_429n)).toThrowError(expect.objectContaining({ code: "order_too_large" }));
  });

  it("allows an ordinary order", () => {
    expect(() => assertPayableInStages(126_000_000n)).not.toThrow(); // ₦1,260,000
  });
});
