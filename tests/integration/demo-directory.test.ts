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

async function draftRequest(isDemo: boolean) {
  const request = await makeRequest();
  return db().request.update({ where: { id: request.id }, data: { status: "DRAFT", isDemo } });
}

describe("a fresh deployment's empty vendor directory", () => {
  it("in demo mode the first invite seeds the demo vendor directory and asks a shortlist", async () => {
    setDemoMode(true);
    await db().vendorContact.deleteMany();
    const request = await draftRequest(true);
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

  it("outside demo mode nobody is invented: a real purchase with no registered match asks no one", async () => {
    setDemoMode(false);
    await db().vendorContact.deleteMany();
    const request = await draftRequest(false);
    await expect(inviteVendors(request.id)).resolves.toEqual([]);
    expect(await db().vendorContact.count()).toBe(0);
    expect((await db().request.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("COLLECTING");
  });

  it("a real purchase never reaches the demo vendors, and a demo never reaches real ones", async () => {
    setDemoMode(true);
    await db().vendorContact.deleteMany();
    await inviteVendors((await draftRequest(true)).id); // seeds the demo vendors
    const real = await db().vendorContact.create({
      data: { businessName: "Owerri Prints Ltd", phone: "+234 803 555 0101", category: "printing branded shirt tshirt", city: "Owerri", registeredAt: new Date(), rcNumber: "RC00000011", bankCode: "058", accountNumber: "0123456789", email: "hello@owerri.example" },
    });
    const realInvites = await inviteVendors((await draftRequest(false)).id);
    expect(realInvites.map((i) => i.businessName)).toEqual([real.businessName]);
    const demoInvites = await inviteVendors((await draftRequest(true)).id);
    expect(demoInvites.map((i) => i.businessName)).not.toContain(real.businessName);
  });
});
