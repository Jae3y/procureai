import { describe, expect, it } from "vitest";
import { POST as passwordPost } from "@/app/api/account/password/route";
import { GET as exportGet } from "@/app/api/account/export/route";
import { POST as loginPost } from "@/app/api/auth/login/route";
import { POST as resetPost } from "@/app/api/auth/reset/route";
import { POST as signupPost } from "@/app/api/auth/signup/route";
import { POST as inviteRoute } from "@/app/api/requests/[id]/invite/route";
import { POST as addVendorRoute } from "@/app/api/requests/[id]/vendors/route";
import { GET as requestGet } from "@/app/api/requests/[id]/route";
import { POST as createRequestRoute } from "@/app/api/requests/route";
import { POST as vendorProfilePost } from "@/app/api/vendor/profile/route";
import { POST as registerPost } from "@/app/api/vendors/register/route";
import { POST as quotePost } from "@/app/api/vendors/[token]/quote/route";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { inviteTokenFor, sha256Hex } from "@/lib/crypto";
import { db } from "@/lib/db";
import { resetEnvCache } from "@/lib/env";
import { accountCookieName, accountFrom, buyerSessionCookie } from "@/lib/http/session";
import type { RequestView } from "@/lib/views/request-view";
import { makeBuyer } from "../helpers/factories";
import { useKoraDouble } from "../helpers/kora";

useKoraDouble();

type Handler<P extends Record<string, string>> = (req: Request, ctx: { params: Promise<P> }) => Promise<Response>;

/** A browser: keeps the cookies it is given and sends them back. */
class Browser {
  jar = new Map<string, string>();
  async call<P extends Record<string, string>>(handler: Handler<P>, path: string, params: P, body?: unknown, headers: Record<string, string> = {}) {
    const h: Record<string, string> = { "content-type": "application/json", ...headers };
    if (this.jar.size) h.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await handler(
      new Request(`http://localhost:3000${path}`, { method: body === undefined ? "GET" : "POST", headers: h, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }),
      { params: Promise.resolve(params) },
    );
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const [k, ...v] = (pair ?? "").split("=");
      if (k) this.jar.set(k, v.join("="));
    }
    return { status: res.status, body: (await res.json()) as Record<string, unknown> & { error?: { code: string } } };
  }
  cookieHeader(): string {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

const PASSWORD = "correct horse battery";

async function signedIn(email = `buyer+${Date.now()}${Math.random()}@example.com`) {
  const b = new Browser();
  const r = await b.call(signupPost, "/api/auth/signup", {}, { name: "Ada Obi", email, password: PASSWORD });
  expect(r.status).toBe(201);
  return { b, email };
}

describe("passwords", () => {
  it("are stored as scrypt hashes and checked in constant time", async () => {
    const stored = await hashPassword(PASSWORD);
    expect(stored).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(stored).not.toContain(PASSWORD);
    expect(await verifyPassword(PASSWORD, stored)).toBe(true);
    expect(await verifyPassword("wrong password!", stored)).toBe(false);
  });
});

describe("accounts", () => {
  it("sign up, sign in, and refuse a wrong password or a second account with the same email", async () => {
    const { email } = await signedIn("Ada@Example.com");
    const account = await db().account.findUniqueOrThrow({ where: { email: "ada@example.com" } });
    expect(account.passwordHash).toMatch(/^scrypt\$/);

    const again = await new Browser().call(signupPost, "/api/auth/signup", {}, { name: "Someone", email, password: PASSWORD });
    expect(again).toMatchObject({ status: 409, body: { error: { code: "email_taken" } } });

    const wrong = await new Browser().call(loginPost, "/api/auth/login", {}, { email, password: "not the password" });
    expect(wrong).toMatchObject({ status: 401, body: { error: { code: "bad_login" } } });
    const unknown = await new Browser().call(loginPost, "/api/auth/login", {}, { email: "nobody@example.com", password: PASSWORD });
    expect(unknown).toMatchObject({ status: 401, body: { error: { code: "bad_login" } } });

    const ok = new Browser();
    expect((await ok.call(loginPost, "/api/auth/login", {}, { email: "ADA@example.com", password: PASSWORD })).status).toBe(200);
    expect(ok.jar.has(accountCookieName())).toBe(true);
  });

  it("never adopts an older buyer with the same email: that email was never proven", async () => {
    const old = await db().buyer.create({ data: { name: "Earlier visitor", email: "taken@example.com" } });
    await signedIn("taken@example.com");
    const account = await db().account.findUniqueOrThrow({ where: { email: "taken@example.com" } });
    expect(account.buyerId).not.toBe(old.id);
  });

  it("slows down guessing: eight wrong passwords per account per ten minutes", async () => {
    const { email } = await signedIn();
    const statuses: number[] = [];
    for (let i = 0; i < 9; i++) statuses.push((await new Browser().call(loginPost, "/api/auth/login", {}, { email, password: `guess number ${i}` })).status);
    expect(statuses.slice(0, 8).every((s) => s === 401)).toBe(true);
    expect(statuses[8]).toBe(429);
  });

  it("changing the password ends every older session", async () => {
    const { b } = await signedIn();
    const other = new Browser();
    other.jar = new Map(b.jar);
    const changed = await b.call(passwordPost, "/api/account/password", {}, { current: PASSWORD, next: "a brand new password" });
    expect(changed.status).toBe(200);
    expect(await accountFrom(new Request("http://localhost:3000/", { headers: { cookie: other.cookieHeader() } }))).toBeNull();
    expect(await accountFrom(new Request("http://localhost:3000/", { headers: { cookie: b.cookieHeader() } }))).not.toBeNull();
  });

  it("a reset link works once, proves the email, and signs out everywhere else", async () => {
    const { b, email } = await signedIn();
    const account = await db().account.findUniqueOrThrow({ where: { email } });
    const token = "reset-token-for-the-test-0123456789";
    await db().accountToken.create({ data: { accountId: account.id, purpose: "RESET", tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + 60_000) } });

    const fresh = new Browser();
    expect((await fresh.call(resetPost, "/api/auth/reset", {}, { token, password: "chosen after reset" })).status).toBe(200);
    expect((await new Browser().call(resetPost, "/api/auth/reset", {}, { token, password: "chosen after reset" })).body.error?.code).toBe("invalid_link");
    expect(await accountFrom(new Request("http://localhost:3000/", { headers: { cookie: b.cookieHeader() } }))).toBeNull();
    expect((await db().account.findUniqueOrThrow({ where: { id: account.id } })).emailVerifiedAt).not.toBeNull();
  });

  it("refuses a write sent from another site", async () => {
    const r = await new Browser().call(loginPost, "/api/auth/login", {}, { email: "a@example.com", password: PASSWORD }, { origin: "https://evil.example", host: "localhost:3000" });
    expect(r).toMatchObject({ status: 403, body: { error: { code: "cross_site" } } });
  });

  it("exports only the signed-in person's own purchases", async () => {
    const { b } = await signedIn();
    const mine = await b.call(createRequestRoute, "/api/requests", {}, { text: "300 branded T-shirts, under ₦1.5m, delivered by 23 December" });
    expect(mine.status).toBe(201);
    const stranger = await makeBuyer();
    await db().request.create({ data: { buyerId: stranger.id, rawText: "x", item: "Chairs", quantity: 3, budgetKobo: 100n, deadline: new Date(), specParsedBy: "FALLBACK" } });
    const data = await b.call(exportGet, "/api/account/export", {});
    expect((data.body.requests as Array<{ id: string }>).map((r) => r.id)).toEqual([mine.body.id]);
  });
});

describe("real purchases and demo purchases stay apart", () => {
  it("a signed-in buyer's purchase is real; a visitor's is the demo", async () => {
    const { b } = await signedIn();
    const real = await b.call(createRequestRoute, "/api/requests", {}, { text: "300 branded T-shirts, under ₦1.5m, delivered by 23 December" });
    const visitor = await new Browser().call(createRequestRoute, "/api/requests", {}, { text: "300 branded T-shirts, under ₦1.5m, delivered by 23 December" });
    expect((await db().request.findUniqueOrThrow({ where: { id: String(real.body.id) } })).isDemo).toBe(false);
    expect((await db().request.findUniqueOrThrow({ where: { id: String(visitor.body.id) } })).isDemo).toBe(true);
  });

  it("outside demo mode a visitor must sign in to buy", async () => {
    Object.assign(process.env, { DEMO_MODE: "false", ADMIN_TOKEN: "accounts-test-admin-token-0123456789" });
    resetEnvCache();
    try {
      const r = await new Browser().call(createRequestRoute, "/api/requests", {}, { text: "300 branded T-shirts, under ₦1.5m, delivered by 23 December" });
      expect(r).toMatchObject({ status: 401, body: { error: { code: "sign_in_required" } } });
    } finally {
      Object.assign(process.env, { DEMO_MODE: "true", ADMIN_TOKEN: "" });
      resetEnvCache();
    }
  });

  it("one browser can be signed in and keep its demo purchase", async () => {
    const b = new Browser();
    const demoBuyer = await makeBuyer();
    const demoCookie = buyerSessionCookie(demoBuyer.id).split(";")[0] ?? "";
    const [k, ...v] = demoCookie.split("=");
    b.jar.set(k ?? "", v.join("="));
    const demoRequest = await db().request.create({ data: { buyerId: demoBuyer.id, rawText: "x", item: "Chairs", quantity: 3, budgetKobo: 100n, deadline: new Date(), specParsedBy: "FALLBACK", isDemo: true } });
    await b.call(signupPost, "/api/auth/signup", {}, { name: "Ada Obi", email: "both@example.com", password: PASSWORD });
    expect((await b.call(requestGet, `/api/requests/${demoRequest.id}`, { id: demoRequest.id })).status).toBe(200);
  });

  it("the buyer adds a vendor they know, gets a WhatsApp link, and hears when the vendor replies", async () => {
    const { b, email } = await signedIn();
    const created = await b.call(createRequestRoute, "/api/requests", {}, { text: "300 branded T-shirts, under ₦1.5m, delivered by 23 December" });
    const id = String(created.body.id);
    expect((await b.call(addVendorRoute, `/api/requests/${id}/vendors`, { id }, { businessName: "Too Early Ltd", phone: "0803 000 0001" })).body.error?.code).toBe("closed");
    expect((await b.call(inviteRoute, `/api/requests/${id}/invite`, { id }, {})).status).toBe(201); // nobody registered sells it: asks no one
    const added = await b.call(addVendorRoute, `/api/requests/${id}/vendors`, { id }, { businessName: "Kemi Prints", phone: "0803 777 2211" });
    expect(added).toMatchObject({ status: 201, body: { label: "Vendor A" } });
    expect((await b.call(addVendorRoute, `/api/requests/${id}/vendors`, { id }, { businessName: "Kemi Prints", phone: "+234 803 777 2211" })).body.error?.code).toBe("already_asked");

    const view = (await b.call(requestGet, `/api/requests/${id}`, { id })).body as unknown as RequestView;
    expect(view.isDemo).toBe(false);
    expect(view.invites).toHaveLength(1);
    expect(view.invites?.[0]?.whatsapp).toMatch(/^https:\/\/wa\.me\/2348037772211\?text=/);
    const contact = await db().vendorContact.findUniqueOrThrow({ where: { phone: "+234 803 777 2211" } });
    expect(contact.registeredAt).toBeNull(); // only the vendor can register themselves

    const token = inviteTokenFor(id, "Vendor A");
    const quote = await new Browser().call(quotePost, `/api/vendors/${token}/quote`, { token }, {
      reply: "₦4,000 each, 300 pieces, ready in 7 days, 50% upfront",
      businessName: "Kemi Prints",
      rcNumber: "RC00000011",
      bankCode: "058",
      accountNumber: "0123456789",
      email: "kemi@example.com",
      consent: true,
    });
    expect(quote.status).toBe(201);
    const account = await db().account.findUniqueOrThrow({ where: { email } });
    expect(await db().notification.findMany({ where: { accountId: account.id }, select: { kind: true, href: true } })).toEqual([{ kind: "quote", href: `/buy/${id}` }]);
  });
});

describe("vendor accounts", () => {
  const PROFILE = { businessName: "Owerri Prints Ltd", phone: "0803 555 0101", sells: "T-shirts, printing", city: "Owerri", rcNumber: "RC00000011", bankCode: "058", accountNumber: "0123456789", email: "Hello@OwerriPrints.example", consent: true };

  it("registering with a password opens a signed-in vendor account; editing needs the password", async () => {
    const b = new Browser();
    const r = await b.call(registerPost, "/api/vendors/register", {}, { ...PROFILE, password: PASSWORD });
    expect(r.status).toBe(201);
    const account = await db().account.findUniqueOrThrow({ where: { email: "hello@owerriprints.example" } });
    expect(account.vendorContactId).toBe(r.body.id);

    const edit = { businessName: "Owerri Prints Ltd", sells: "printing", city: "Owerri", rcNumber: "RC00000011", bankCode: "058", accountNumber: "0123456789", email: "hello@owerriprints.example" };
    expect((await b.call(vendorProfilePost, "/api/vendor/profile", {}, { ...edit, password: "not my password" })).body.error?.code).toBe("wrong_password");
    expect((await b.call(vendorProfilePost, "/api/vendor/profile", {}, { ...edit, city: "Port Harcourt", password: PASSWORD })).status).toBe(200);
    expect((await db().vendorContact.findUniqueOrThrow({ where: { id: String(r.body.id) } })).city).toBe("Port Harcourt");
  });

  it("a registered vendor hears about a matching real request", async () => {
    const vendor = new Browser();
    await vendor.call(registerPost, "/api/vendors/register", {}, { ...PROFILE, password: PASSWORD });
    const { b } = await signedIn();
    const created = await b.call(createRequestRoute, "/api/requests", {}, { text: "300 branded T-shirts, under ₦1.5m, delivered by 23 December" });
    const id = String(created.body.id);
    await b.call(inviteRoute, `/api/requests/${id}/invite`, { id }, {});
    const account = await db().account.findUniqueOrThrow({ where: { email: "hello@owerriprints.example" } });
    const note = await db().notification.findFirstOrThrow({ where: { accountId: account.id, kind: "invite" } });
    expect(note.href).toBe(`/v/${inviteTokenFor(id, "Vendor A")}`);
  });
});
