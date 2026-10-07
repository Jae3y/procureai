import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { DEMO_VENDORS } from "@/lib/demo/script";
import { inviteVendors } from "@/lib/domain/requests";
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
  it("in demo mode the first invite seeds the three demo vendors", async () => {
    setDemoMode(true);
    await db().vendorContact.deleteMany();
    const request = await draftRequest();
    const invites = await inviteVendors(request.id);
    expect(invites.map((i) => i.businessName).sort()).toEqual(DEMO_VENDORS.map((v) => v.businessName).sort());
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
