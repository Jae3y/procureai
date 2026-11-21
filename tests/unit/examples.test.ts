import { describe, expect, it } from "vitest";
import { exampleRequests } from "@/lib/examples";

describe("exampleRequests", () => {
  it("dates every example in the future, counted from today in Lagos", () => {
    // 21 Nov 2026, 23:30 UTC is already 22 Nov in Lagos (UTC+1).
    const ex = exampleRequests(new Date("2026-11-21T23:30:00Z"));
    expect(ex.map((e) => e.full)).toEqual([
      "300 branded T-shirts, under ₦1.5m, delivered by 13 December",
      "120 lab coats, under ₦1.1m, delivered by 20 December",
      "40 cartons of noodles, under ₦600k, delivered by 6 December",
    ]);
  });

  it("always reads as a day and month (year added only when it differs)", () => {
    for (const iso of ["2026-01-01T00:00:00Z", "2026-10-30T12:00:00Z", "2027-02-20T08:00:00Z"]) {
      for (const e of exampleRequests(new Date(iso))) {
        expect(e.full).toMatch(/delivered by \d{1,2} [A-Z][a-z]+( \d{4})?$/);
      }
    }
  });
});
