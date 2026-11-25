import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/internal/growth-stats/route";
import { POST as signupPost } from "@/app/api/auth/signup/route";
import { db } from "@/lib/db";
import { googleSignIn, signInWithGoogle } from "@/lib/domain/accounts";
import { resetEnvCache } from "@/lib/env";
import { yesterdayInLagos } from "@/lib/growth-stats";
import { fundOrder, makeOrderFixture } from "../helpers/factories";
import { signupBody } from "../helpers/signup";

const TOKEN = "growth-stats-test-token-0123456789abcdef";

async function get(query: string, auth: string | null = `Bearer ${TOKEN}`) {
  const res = await GET(
    new Request(`http://localhost:3000/api/internal/growth-stats${query}`, { headers: auth ? { authorization: auth } : {} }),
    { params: Promise.resolve({}) },
  );
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, body: JSON.parse(text) as Record<string, unknown> };
}

let n = 0;
/** An account (with its buyer) opened at a given instant. */
async function account(at: string, data: Record<string, unknown> = {}) {
  n += 1;
  const buyer = await db().buyer.create({ data: { name: `Person ${n}`, email: `person${n}@example.com` } });
  return db().account.create({ data: { email: `person${n}@example.com`, name: `Person ${n}`, buyerId: buyer.id, createdAt: new Date(at), ...data } });
}

/** A registered vendor profile (the database insists registered profiles are complete). */
async function vendor(phone: string, registeredAt: string, isDemo = false) {
  return db().vendorContact.create({
    data: { businessName: `Shop ${phone}`, phone, category: "printing", city: "Owerri", registeredAt: new Date(registeredAt), isDemo, ownerName: "Ngozi Okafor", bankCode: "058", accountNumber: "0123456789", email: `shop${phone.replace(/\D/g, "")}@example.com` },
  });
}

async function request(buyerId: string, at: string, isDemo = false) {
  return db().request.create({
    data: {
      buyerId,
      rawText: "200 branded caps",
      item: "Branded caps",
      quantity: 200,
      budgetKobo: 50_000_000n,
      deadline: new Date("2026-12-20T00:00:00Z"),
      specParsedBy: "FALLBACK",
      isDemo,
      createdAt: new Date(at),
    },
  });
}

beforeEach(() => {
  process.env.GROWTH_STATS_TOKEN = TOKEN;
  resetEnvCache();
});

afterEach(() => {
  delete process.env.GROWTH_STATS_TOKEN;
  resetEnvCache();
});

describe("GET /api/internal/growth-stats: access", () => {
  it("is switched off (404) while GROWTH_STATS_TOKEN is unset", async () => {
    delete process.env.GROWTH_STATS_TOKEN;
    resetEnvCache();
    expect((await get("?date=2026-11-20")).status).toBe(404);
  });

  it("refuses a missing, wrong or malformed token with 401", async () => {
    expect((await get("?date=2026-11-20", null)).status).toBe(401);
    expect((await get("?date=2026-11-20", "Bearer wrong-token")).status).toBe(401);
    expect((await get("?date=2026-11-20", `Bearer ${TOKEN}x`)).status).toBe(401);
    expect((await get("?date=2026-11-20", TOKEN)).status).toBe(401); // no "Bearer " scheme
  });

  it("validates the date and is never cached", async () => {
    for (const bad of ["2026-02-30", "20261120", "yesterday", ""]) expect((await get(`?date=${bad}`)).status).toBe(400);
    const ok = await get("?date=2026-11-20");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
  });

  it("defaults to yesterday in Lagos", async () => {
    expect((await get("")).body.date).toBe(yesterdayInLagos(new Date()));
  });
});

describe("GET /api/internal/growth-stats: the numbers", () => {
  it("counts one Lagos day of sign-ups, by method and source, with vendors apart", async () => {
    // 2026-11-20 in Lagos is 2026-11-19T23:00Z .. 2026-11-20T23:00Z.
    const a = await account("2026-11-19T23:30:00Z", { signupMethod: "email", utmSource: "newsletter", heardFrom: "FRIEND", passwordHash: "x" }); // 00:30 Lagos: in
    const b = await account("2026-11-20T22:59:00Z", { signupMethod: "google", googleSub: "g-1", heardFrom: "WHATSAPP" }); // 23:59 Lagos: in
    await account("2026-11-20T12:00:00Z", { googleSub: "g-legacy" }); // from before signupMethod: Google, no password, source unknown
    await account("2026-11-20T13:00:00Z", { signupMethod: "email", referrerHost: "google.com", passwordHash: "x" });
    const c = await account("2026-11-19T22:59:00Z", { signupMethod: "email", passwordHash: "x" }); // 23:59 Lagos on the 19th: out
    const vendorForm = await account("2026-11-20T09:00:00Z", { signupMethod: "vendor" }); // the vendor form: not a buyer sign-up
    // A vendor-form account from before signupMethod was kept: vendor profile, no Google id, no buy/sell answer.
    const legacyShop = await vendor("+234 803 000 0009", "2026-11-10T10:00:00Z");
    await account("2026-11-20T09:30:00Z", { vendorContactId: legacyShop.id, passwordHash: "x" });
    // Visitor-typed sources that could carry personal data, or would collide with object keys, are bucketed as "other".
    await account("2026-11-20T14:00:00Z", { signupMethod: "email", utmSource: "08031234567", passwordHash: "x" });
    await account("2026-11-20T14:30:00Z", { signupMethod: "email", utmSource: "__proto__", passwordHash: "x" });
    await vendor("+234 803 000 0001", "2026-11-20T10:00:00Z");
    await vendor("+234 803 000 0002", "2026-11-20T10:00:00Z", true);
    await vendor("+234 803 000 0003", "2026-11-19T22:30:00Z"); // the 19th in Lagos

    // Activation: the first real request. a's first is today; b had one on the 18th; c's only one today is a demo.
    await request(a.buyerId, "2026-11-20T10:00:00Z");
    await request(a.buyerId, "2026-11-20T11:00:00Z");
    await request(b.buyerId, "2026-11-18T10:00:00Z");
    await request(b.buyerId, "2026-11-20T10:00:00Z");
    await request(c.buyerId, "2026-11-20T10:00:00Z", true);
    await request(vendorForm.buyerId, "2026-11-20T10:00:00Z"); // a vendor account buying: not a buyer activation

    const r = await get("?date=2026-11-20");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      product: "procureai",
      date: "2026-11-20",
      timezone: "Africa/Lagos",
      signups: 6,
      signups_by_method: { email: 4, google: 2 },
      signups_by_source: { newsletter: 1, whatsapp: 1, unknown: 1, "google.com": 1, other: 2 },
      vendor_signups: 1,
      activations: 1,
      purchases: 0,
      revenue_minor: 0,
      currency: "NGN",
      payments_mode: "test", // the test env runs a sk_test_ key with DEMO_MODE on
      totals: { users: 7, activated_users: 2, paying_customers: 0, vendors: 3 },
    });
    expect(typeof r.body.activation_definition).toBe("string");
    expect(new Date(r.body.generated_at as string).toString()).not.toBe("Invalid Date");

    // The day before only sees c, and the vendor registered late on the 19th.
    expect((await get("?date=2026-11-19")).body).toMatchObject({ signups: 1, vendor_signups: 1, activations: 0 });
  });

  it("counts purchases on the day the pay-in succeeded (order reached HELD), real orders only, in kobo", async () => {
    const real = await makeOrderFixture({ amountKobo: 126_000_000n });
    const buyerAccount = await db().account.create({ data: { email: "payer@example.com", name: "Payer", buyerId: real.request.buyerId, signupMethod: "email" } });
    await fundOrder(real.order.id, 126_000_000n);
    const demo = await makeOrderFixture({ amountKobo: 50_000_000n });
    await db().request.update({ where: { id: demo.request.id }, data: { isDemo: true } });
    await fundOrder(demo.order.id, 50_000_000n);
    const unpaid = await makeOrderFixture({ amountKobo: 70_000_000n });
    expect(unpaid.order.status).toBe("CREATED");

    const today = yesterdayInLagos(new Date(Date.now() + 24 * 60 * 60 * 1000));
    const r = await get(`?date=${today}`);
    expect(r.body).toMatchObject({ purchases: 1, revenue_minor: 126_000_000, totals: { paying_customers: 1 } });
    expect(r.text).not.toContain(buyerAccount.id);
  });

  it("never carries personal data: aggregates only, the exact contract keys", async () => {
    const a = await account("2026-11-20T10:00:00Z", { signupMethod: "email", utmSource: "x", passwordHash: "x", phone: "+234 803 111 2222" });
    await request(a.buyerId, "2026-11-20T11:00:00Z");
    const r = await get("?date=2026-11-20");
    for (const secret of [a.email, a.name, a.id, a.buyerId, "+234", "passwordHash"]) expect(r.text).not.toContain(secret);
    expect(Object.keys(r.body).sort()).toEqual(
      [
        "product", "date", "timezone", "signups", "signups_by_method", "signups_by_source", "vendor_signups", "activations",
        "activation_definition", "purchases", "revenue_minor", "currency", "payments_mode", "totals", "generated_at",
      ].sort(),
    );
    expect(Object.keys(r.body.totals as object).sort()).toEqual(["activated_users", "paying_customers", "users", "vendors"]);
  });
});

describe("sign-up keeps the first touch", () => {
  it("email sign-up saves the pai_ft cookie on the account and flags GA's sign_up event", async () => {
    const res = await signupPost(
      new Request("http://localhost:3000/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: "other=1; pai_ft=s%3Dinstagram%26m%3Dsocial%26c%3Dlaunch" },
        body: JSON.stringify(signupBody({ email: "touch@example.com", heardFrom: "FRIEND" })),
      }),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(201);
    expect(res.headers.getSetCookie().some((c) => c.startsWith("pai_signup=email;") && !c.includes("HttpOnly"))).toBe(true);
    const a = await db().account.findUniqueOrThrow({ where: { email: "touch@example.com" } });
    expect(a).toMatchObject({ signupMethod: "email", utmSource: "instagram", utmMedium: "social", utmCampaign: "launch", referrerHost: null, heardFrom: "FRIEND" });
  });

  it("Google sign-up records its method and attribution; a returning Google sign-in changes nothing", async () => {
    const profile = { sub: "google-sub-growth", email: "g@example.com", name: "Gee" };
    const a = await signInWithGoogle(profile, { utmSource: null, utmMedium: null, utmCampaign: null, referrerHost: "x.com" });
    expect(a).toMatchObject({ signupMethod: "google", referrerHost: "x.com" });
    const again = await signInWithGoogle(profile, { utmSource: "later", utmMedium: null, utmCampaign: null, referrerHost: null });
    expect(again).toMatchObject({ id: a.id, utmSource: null, referrerHost: "x.com" });
  });

  it("only the call that opens a Google account reports it as created (the GA sign_up event fires once)", async () => {
    const profile = { sub: "google-sub-created", email: "c@example.com", name: "Cee" };
    expect((await googleSignIn(profile)).created).toBe(true);
    expect((await googleSignIn(profile)).created).toBe(false);
  });
});
