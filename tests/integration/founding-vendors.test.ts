import { describe, expect, it } from "vitest";
import { GET as spotsGet } from "@/app/api/public/founding-spots/route";
import { db } from "@/lib/db";
import { ensureDemoDirectory } from "@/lib/demo/directory";
import { FOUNDING_VENDOR_LIMIT, claimFoundingSpot, foundingSpotsTaken } from "@/lib/founding";
import { registerVendor, type VendorRegistration } from "@/lib/domain/vendor-profiles";

const profile = (n: number): VendorRegistration => ({
  businessName: `Vendor ${n} Ltd`,
  phone: `0803 555 ${String(1000 + n)}`,
  sells: "printing",
  city: "Owerri",
  rcNumber: "RC00000011",
  bankCode: "058",
  accountNumber: "0123456789",
  email: `vendor${n}@example.com`,
  consent: true,
});

describe("Founding Vendors", () => {
  it("numbers the first real businesses 1, 2, 3 in order, and only once each", async () => {
    const a = await registerVendor(profile(1));
    const b = await registerVendor(profile(2));
    expect([a.foundingNumber, b.foundingNumber]).toEqual([1, 2]);
    expect(await claimFoundingSpot(a.id)).toBe(1); // asking again never changes it
    expect(await foundingSpotsTaken()).toBe(2);
  });

  it("stops at the limit: the last spot is taken, the next business gets none", async () => {
    // 99 spots already taken (numbers 1..99).
    for (let i = 1; i <= FOUNDING_VENDOR_LIMIT - 1; i++) {
      await db().vendorContact.create({
        data: {
          businessName: `Early ${i}`,
          phone: `+234 700 000 ${String(1000 + i)}`,
          category: "x",
          city: "x",
          registeredAt: new Date(),
          rcNumber: "RC00000011",
          bankCode: "058",
          accountNumber: "0123456789",
          email: `early${i}@example.com`,
          foundingNumber: i,
        },
      });
    }
    const last = await registerVendor(profile(500));
    const after = await registerVendor(profile(501));
    expect(last.foundingNumber).toBe(FOUNDING_VENDOR_LIMIT);
    expect(after.foundingNumber).toBeNull();
    expect(await foundingSpotsTaken()).toBe(FOUNDING_VENDOR_LIMIT);
  });

  it("two businesses registering at the same moment never share a number", async () => {
    const results = await Promise.all([1, 2, 3, 4, 5, 6].map((n) => registerVendor(profile(700 + n))));
    const numbers = results.map((r) => r.foundingNumber);
    expect(numbers.every((n) => n !== null)).toBe(true);
    expect(new Set(numbers).size).toBe(6);
  });

  it("the scripted demo vendors never get a number", async () => {
    await ensureDemoDirectory();
    expect(await db().vendorContact.count({ where: { isDemo: true, foundingNumber: { not: null } } })).toBe(0);
    const demo = await db().vendorContact.findFirstOrThrow({ where: { isDemo: true } });
    expect(await claimFoundingSpot(demo.id)).toBeNull();
  });

  it("the public count is available to anyone", async () => {
    await registerVendor(profile(900));
    const res = await spotsGet();
    expect(res.headers.get("cache-control")).toContain("s-maxage=60");
    expect(await res.json()).toEqual({ taken: 1, limit: FOUNDING_VENDOR_LIMIT });
  });
});
