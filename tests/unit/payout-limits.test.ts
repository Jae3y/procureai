import { describe, expect, it } from "vitest";
import { assertPayableInStages } from "@/lib/domain/approve";

/**
 * Kora pays out ₦1,000 to ₦10,000,000 per transfer. The smallest order whose 30% reaches ₦1,000 is ₦3,333.34.
 * A stage above ₦10,000,000 is paid in parts, so the ceiling is ProcureAI's own: ₦100,000,000 for now.
 */
describe("orders must be payable in two stages", () => {
  it("accepts the smallest payable order and the ₦100,000,000 ceiling", () => {
    expect(() => assertPayableInStages(333_334n)).not.toThrow();
    expect(() => assertPayableInStages(10_000_000_000n)).not.toThrow();
  });

  it("refuses an order whose 30% would be under the ₦1,000 payout minimum", () => {
    expect(() => assertPayableInStages(333_333n)).toThrowError(expect.objectContaining({ code: "order_too_small" }));
  });

  it("accepts an order whose 70% is over the ₦10,000,000 per-transfer maximum: it is paid in parts", () => {
    expect(() => assertPayableInStages(1_428_571_429n)).not.toThrow();
    expect(() => assertPayableInStages(5_000_000_000n)).not.toThrow(); // ₦50,000,000
  });

  it("refuses an order above the ₦100,000,000 ceiling, with the ceiling in the message", () => {
    expect(() => assertPayableInStages(10_000_000_001n)).toThrowError(expect.objectContaining({ code: "order_too_large", userMessage: expect.stringContaining("₦100,000,000") }));
  });

  it("allows an ordinary order", () => {
    expect(() => assertPayableInStages(126_000_000n)).not.toThrow(); // ₦1,260,000
  });
});
