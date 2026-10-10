import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { DEMO_VENDORS } from "@/lib/demo/script";
import { createRequest, inviteVendors } from "@/lib/domain/requests";
import { makeBuyer } from "../helpers/factories";
import { resetEnvCache } from "@/lib/env";
import { makeRequest } from "../helpers/factories";

function setDemoMode(on: boolean) {
  process.env.DEMO_MODE = on ? "true" : "false";
  process.env.ADMIN_TOKEN = on ? "" : "demo-directory-test-admin-token-0123456789"; // required when DEMO_MODE=false
  resetEnvCache();
}

afterEach(() => setDemoMode(true));

async function draftRequest() {
  const request = await makeRequest();
  return db().request.update({ where: { id: request.id }, data: { status: "DRAFT" } });
}

describe("a fresh deployment's empty vendor directory", () => {
  it("in demo mode the first invite seeds the demo vendor directory and asks a shortlist", async () => {
    setDemoMode(true);
    await db().vendorContact.deleteMany();
    const request = await draftRequest();
    const invites = await inviteVendors(request.id);
    expect(await db().vendorContact.count()).toBe(DEMO_VENDORS.length); // the whole market is in the directory
    expect(invites.length).toBeLessThanOrEqual(8); // only the shortlist for this item is asked
    expect(invites.map((i) => i.businessName)).toEqual(expect.arrayContaining(["Mama Tobi Trading", "Kwik Supplies", "Imole Wholesale Ltd"]));
  });

  it("in demo mode creating a request seeds them too, so the page can offer 'Ask vendors'", async () => {
    setDemoMode(true);
    await db().vendorContact.deleteMany();
    const buyer = await makeBuyer();
    await createRequest({ rawText: "300 branded T-shirts, under ₦1.5m, delivered by 23 October", buyerId: buyer.id });
    expect(await db().vendorContact.count()).toBe(DEMO_VENDORS.length);
  });

  it("outside demo mode an empty directory is reported, never invented", async () => {
    setDemoMode(false);
    await db().vendorContact.deleteMany();
    const request = await draftRequest();
    await expect(inviteVendors(request.id)).rejects.toMatchObject({ code: "no_vendors" });
    expect(await db().vendorContact.count()).toBe(0);
  });
});
