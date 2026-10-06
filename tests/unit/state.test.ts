import { describe, expect, it } from "vitest";
import { allTransitions, canTransition, ORDER_TRANSITIONS, retryTarget } from "@/lib/domain/state";
import type { OrderStatus } from "@/lib/generated/prisma/client";

const ALL = Object.keys(ORDER_TRANSITIONS) as OrderStatus[];

describe("state machine — legal transitions (§5)", () => {
  it.each([
    ["CREATED", "AWAITING_PAYMENT"],
    ["AWAITING_PAYMENT", "UNDERPAID"],
    ["AWAITING_PAYMENT", "HELD"],
    ["UNDERPAID", "AWAITING_PAYMENT"],
    ["UNDERPAID", "HELD"],
    ["HELD", "STAGE_1_PAID"],
    ["STAGE_1_PAID", "CODE_VERIFIED"],
    ["CODE_VERIFIED", "RELEASED"],
    ["RELEASED", "COMPLETE"],
    ["STAGE_1_PAID", "PAYOUT_FAILED"],
    ["RELEASED", "PAYOUT_FAILED"],
    ["PAYOUT_FAILED", "STAGE_1_PAID"],
    ["PAYOUT_FAILED", "RELEASED"],
    ["HELD", "DISPUTED"],
    ["STAGE_1_PAID", "DISPUTED"],
    ["DISPUTED", "REFUNDED"],
  ] as Array<[OrderStatus, OrderStatus]>)("%s → %s is legal", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it("has exactly the 16 transitions of §5 and nothing else", () => {
    expect(allTransitions()).toHaveLength(16);
  });
});

describe("state machine — illegal transitions", () => {
  it.each([
    ["CREATED", "HELD"],
    ["AWAITING_PAYMENT", "STAGE_1_PAID"],
    ["HELD", "COMPLETE"],
    ["HELD", "CODE_VERIFIED"],
    ["STAGE_1_PAID", "RELEASED"],
    ["CODE_VERIFIED", "COMPLETE"],
    ["COMPLETE", "HELD"],
    ["REFUNDED", "HELD"],
    ["RELEASED", "DISPUTED"],
    ["PAYOUT_FAILED", "COMPLETE"],
  ] as Array<[OrderStatus, OrderStatus]>)("%s → %s is illegal", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it("terminal states go nowhere and no state transitions to itself", () => {
    expect(ORDER_TRANSITIONS.COMPLETE).toEqual([]);
    expect(ORDER_TRANSITIONS.REFUNDED).toEqual([]);
    for (const s of ALL) expect(canTransition(s, s)).toBe(false);
  });

  it("a failed payout retries back to the stage it failed from", () => {
    expect(retryTarget("STAGE_1")).toBe("STAGE_1_PAID");
    expect(retryTarget("STAGE_2")).toBe("RELEASED");
  });
});
