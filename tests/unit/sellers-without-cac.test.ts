import { describe, expect, it } from "vitest";
import type { Spec } from "@/lib/ai/fallback";
import { type RankQuote, rankFallback } from "@/lib/ai/rank";
import { BANK_VERIFIED_MAX_KOBO, matchAccountOwner } from "@/lib/domain/matching";

describe("sellers without a CAC registration: the bank account must be in their own name", () => {
  it("verifies when the bank's account name is the seller's own name, in any order", () => {
    expect(matchAccountOwner("OKAFOR NGOZI ADAEZE", "Ngozi Okafor", "Ngozi Prints")).toMatchObject({ verdict: "VERIFIED", matchMethod: "ACCOUNT_OWNER" });
  });

  it("verifies against the trading name too", () => {
    expect(matchAccountOwner("NGOZI PRINTS", "", "Ngozi Prints")).toMatchObject({ verdict: "VERIFIED", matchMethod: "ACCOUNT_OWNER" });
  });

  it("refuses someone else's account, a bare first name, and an account the bank couldn't name", () => {
    expect(matchAccountOwner("CHUKWU EMEKA JOHN", "Ngozi Okafor", "Ngozi Prints")).toMatchObject({ verdict: "FAILED", matchMethod: "NONE" });
    expect(matchAccountOwner("NGOZI", "Ngozi Okafor", null).verdict).toBe("FAILED");
    expect(matchAccountOwner(null, "Ngozi Okafor", null).verdict).toBe("FAILED");
  });
});

describe("ranking: registered businesses first, bank-verified sellers next, both can be chosen", () => {
  const spec: Spec = { item: "Branded T-shirts", quantity: 100, budgetKobo: 40_000_000n, deadline: "2026-12-01" };
  const q = (id: string, totalKobo: bigint, matchMethod: RankQuote["matchMethod"]): RankQuote => ({
    id,
    label: `Vendor ${id}`,
    vendorName: null,
    registeredName: null,
    verdict: "VERIFIED",
    failureReason: null,
    matchMethod,
    totalKobo,
    meetsSpec: true,
    readyDate: null,
  });

  it("recommends a registered business even when a bank-verified seller is cheaper", () => {
    const r = rankFallback(spec, [q("A", 30_000_000n, "ACCOUNT_OWNER"), q("B", 35_000_000n, "COMPANY")]);
    expect(r.chosenQuoteId).toBe("B");
    expect(r.rankedQuoteIds).toEqual(["B", "A"]);
  });

  it("recommends a bank-verified seller when no registered business qualifies, and says so kindly", () => {
    const r = rankFallback(spec, [q("A", 30_000_000n, "ACCOUNT_OWNER")]);
    expect(r.chosenQuoteId).toBe("A");
    expect(r.reasoning).toContain("the bank confirmed its payout account is in the seller's own name");
  });

  it("doesn't recommend a bank-verified seller above the per-purchase limit", () => {
    const r = rankFallback({ ...spec, budgetKobo: 100_000_000n }, [q("A", BANK_VERIFIED_MAX_KOBO + 100n, "ACCOUNT_OWNER")]);
    expect(r.chosenQuoteId).toBeNull();
  });
});
