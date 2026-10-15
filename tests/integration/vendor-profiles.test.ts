import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { normalizeNigerianPhone, registerVendor, type VendorRegistration } from "@/lib/domain/vendor-profiles";
import { submitQuote } from "@/lib/domain/vendors";
import { buildVendorView } from "@/lib/views/vendor-view";
import { POST as quotePost } from "@/app/api/vendors/[token]/quote/route";
import { POST as registerPost } from "@/app/api/vendors/register/route";
import { makeRequest, makeVendor } from "../helpers/factories";
import { useKoraDouble } from "../helpers/kora";

useKoraDouble();

const PROFILE: VendorRegistration = {
  businessName: "Owerri Prints Ltd",
  phone: "0803 555 0101",
  sells: "T-shirts, printing / merch",
  city: "Owerri",
  rcNumber: "rc 00000011",
  bankCode: "058",
  accountNumber: "0123456789",
  email: "Hello@OwerriPrints.example",
  consent: true,
};

/** An invited vendor on a COLLECTING request, linked to `contactId`, with a known invite token. */
async function invited(contactId: string | null, token: string) {
  const request = await makeRequest();
  await db().request.update({ where: { id: request.id }, data: { status: "COLLECTING" } });
  const vendor = await makeVendor(request.id, { label: "Vendor A" });
  await db().vendor.update({
    where: { id: vendor.id },
    data: { contactId, name: null, rcNumber: null, bankCode: null, accountNumber: null, email: null, inviteTokenHash: createHash("sha256").update(token).digest("hex") },
  });
  return { request, vendor };
}

async function postQuote(token: string, body: unknown) {
  const res = await quotePost(
    new Request(`http://localhost:3000/api/vendors/${token}/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ token }) },
  );
  return { status: res.status, body: (await res.json()) as { error?: { code: string; details?: { issues?: Array<{ path: string; message: string }> } } } };
}

describe("vendor registration", () => {
  it("adds the vendor to the directory with a normalised phone and their saved details", async () => {
    const r = await registerVendor(PROFILE);
    const c = await db().vendorContact.findUniqueOrThrow({ where: { id: r.id } });
    expect(c).toMatchObject({
      businessName: "Owerri Prints Ltd",
      phone: "+234 803 555 0101",
      category: "t-shirts printing merch",
      city: "Owerri",
      rcNumber: "RC00000011",
      bankCode: "058",
      accountNumber: "0123456789",
      email: "hello@owerriprints.example",
    });
    expect(c.registeredAt).toBeInstanceOf(Date);
  });

  it("never overwrites a registered profile, so nobody can redirect another vendor's payouts", async () => {
    await registerVendor(PROFILE);
    await expect(registerVendor({ ...PROFILE, phone: "+2348035550101", accountNumber: "9999999999" })).rejects.toMatchObject({ code: "already_registered" });
    expect((await db().vendorContact.findUniqueOrThrow({ where: { phone: "+234 803 555 0101" } })).accountNumber).toBe("0123456789");
  });

  it("lets an existing, unregistered directory entry be claimed once", async () => {
    await db().vendorContact.create({ data: { businessName: "Old name", phone: "+234 803 555 0101", category: "shirts", city: "Aba" } });
    await registerVendor(PROFILE);
    const c = await db().vendorContact.findUniqueOrThrow({ where: { phone: "+234 803 555 0101" } });
    expect(c.businessName).toBe("Owerri Prints Ltd");
    expect(c.registeredAt).not.toBeNull();
  });

  it("checks the phone, consent and fields", async () => {
    expect(normalizeNigerianPhone("2348034127781")).toBe("+234 803 412 7781");
    expect(() => normalizeNigerianPhone("12345")).toThrow(/Nigerian mobile number/);
    await expect(registerVendor({ ...PROFILE, consent: false })).rejects.toMatchObject({ code: "consent_required" });
    const res = await registerPost(
      new Request("http://localhost:3000/api/vendors/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...PROFILE, accountNumber: "123" }),
      }),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { details: { issues: Array<{ path: string }> } } }).error.details.issues.map((i) => i.path)).toEqual(["accountNumber"]);
  });
});

describe("quoting: registered vendors send just the reply; others use the full form", () => {
  it("a registered vendor's quote reuses their profile, and their page says so", async () => {
    const { id } = await registerVendor(PROFILE);
    const token = "registeredVendorTokenForTests001";
    const { vendor } = await invited(id, token);

    const view = await buildVendorView(token);
    expect(view.profile).toEqual({ businessName: "Owerri Prints Ltd", rcNumber: "RC00000011", account: "•••• 6789", email: "hello@owerriprints.example" });

    const res = await postQuote(token, { reply: "I fit do am 4,200 each, ready Thursday" });
    expect(res.status).toBe(201);
    const v = await db().vendor.findUniqueOrThrow({ where: { id: vendor.id } });
    expect(v).toMatchObject({ name: "Owerri Prints Ltd", rcNumber: "RC00000011", bankCode: "058", accountNumber: "0123456789", email: "hello@owerriprints.example" });
    expect(v.consentAt).toBeInstanceOf(Date);
  });

  it("an unregistered vendor must fill in the details, with field-by-field messages", async () => {
    const token = "unregisteredVendorTokenForTest01";
    await invited(null, token);
    expect((await buildVendorView(token)).profile).toBeNull();

    expect((await postQuote(token, { reply: "4,200 each" })).body.error?.code).toBe("consent_required");
    const bad = await postQuote(token, { reply: "4,200 each", businessName: "Kano Grain", rcNumber: "RC00000011", bankCode: "058", accountNumber: "12", email: "a@b.co", consent: true });
    expect(bad.status).toBe(400);
    expect(bad.body.error?.details?.issues?.map((i) => i.path)).toEqual(["accountNumber"]);
    const ok = await postQuote(token, { reply: "4,200 each", businessName: "Kano Grain", rcNumber: "RC 00000011", bankCode: "058", accountNumber: "0123456789", email: "a@b.co", consent: true });
    expect(ok.status).toBe(201);
  });

  it("the domain refuses an unregistered vendor's reply without details", async () => {
    const token = "unregisteredVendorTokenForTest02";
    await invited(null, token);
    await expect(submitQuote(token, { reply: "4,200 each", consent: true })).rejects.toMatchObject({ code: "details_required" });
  });
});
