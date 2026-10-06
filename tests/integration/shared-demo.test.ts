import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as demoControls } from "@/app/api/admin/demo/route";
import { POST as createRequestRoute } from "@/app/api/requests/route";
import { GET as demoEntry } from "@/app/demo/route";
import { db } from "@/lib/db";
import { DEMO_BUYER, DEMO_REQUEST_TEXT } from "@/lib/demo/script";
import { openPayIn } from "@/lib/domain/payin";
import { resetEnvCache } from "@/lib/env";
import { buyerSessionCookie, isAdmin } from "@/lib/http/session";
import { buildOrderView } from "@/lib/views/order-view";
import { makeOrderFixture } from "../helpers/factories";
import { FlowDriver } from "../helpers/flow-driver";
import { useKoraDouble } from "../helpers/kora";

/**
 * A deployed demo is shared by many visitors (DEMO_MODE with an ADMIN_TOKEN): each visitor buys on
 * their own, the sandbox buttons work on their own order only, and only the admin can reset or
 * reconfigure the demo. A local demo (no ADMIN_TOKEN) keeps the presenter's open admin.
 */

const double = useKoraDouble();
const TOKEN = "shared-demo-admin-token-0123456789";

function setEnv(vars: Record<string, string>) {
  Object.assign(process.env, vars);
  resetEnvCache();
}

const bearer = { authorization: `Bearer ${TOKEN}` };

async function demo(body: unknown, headers: Record<string, string> = {}) {
  const res = await demoControls(
    new Request("http://localhost:3000/api/admin/demo", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }),
    { params: Promise.resolve({}) },
  );
  return { status: res.status, body: (await res.json()) as { message?: string } };
}

beforeEach(() => setEnv({ DEMO_MODE: "true", ADMIN_TOKEN: TOKEN }));
afterEach(() => setEnv({ DEMO_MODE: "true", ADMIN_TOKEN: "" }));

describe("shared demo · admin needs the token", () => {
  it("DEMO_MODE alone opens admin; with ADMIN_TOKEN set it takes the token", () => {
    const anon = new Request("http://localhost:3000/admin");
    expect(isAdmin(anon)).toBe(false);
    expect(isAdmin(new Request("http://localhost:3000/admin", { headers: bearer }))).toBe(true);
    setEnv({ ADMIN_TOKEN: "" });
    expect(isAdmin(anon)).toBe(true);
  });

  it("global demo controls are admin-only", async () => {
    expect((await demo({ action: "suppress" })).status).toBe(403);
    expect((await demo({ action: "tick" })).status).toBe(403);
    expect((await demo({ action: "suppress" }, bearer)).status).toBe(200);
  });
});

describe("shared demo · the sandbox buttons work on your own order only", () => {
  it("the buyer can pay and re-check their order; a stranger can't", async () => {
    const f = await makeOrderFixture({ amountKobo: 84_000_000n });
    await openPayIn(f.order.id, f.order.amountKobo, "initial", { type: "USER", id: "t" });
    const own = { cookie: buyerSessionCookie(f.request.buyerId).split(";")[0] ?? "" };

    const pay = await demo({ action: "pay", orderId: f.order.id }, own);
    expect(pay.status).toBe(200);
    expect(pay.body.message).toMatch(/^Kora sandbox credited ₦840,000 to \d{10}\.$/);
    expect((await demo({ action: "recheck", orderId: f.order.id }, own)).status).toBe(200);
    expect((await db().order.findUniqueOrThrow({ where: { id: f.order.id } })).status).toBe("STAGE_1_PAID");

    const stranger = await db().buyer.create({ data: { name: "S", email: "s@example.com" } });
    const theirs = { cookie: buyerSessionCookie(stranger.id).split(";")[0] ?? "" };
    expect((await demo({ action: "recheck", orderId: f.order.id }, theirs)).status).toBe(403);
    expect((await demo({ action: "pay", orderId: f.order.id })).status).toBe(403);
    expect((await demo({ action: "retry-stage", orderId: f.order.id }, own)).status).toBe(403);
    expect(double.callsTo("POST /virtual-bank-account/sandbox/credit")).toBe(1);
  });
});

describe("shared demo · every visitor is their own buyer", () => {
  it("two visitors from /buy get two buyers", async () => {
    const a = new FlowDriver();
    const b = new FlowDriver();
    const ra = await a.call(createRequestRoute, "/api/requests", {}, { body: { text: DEMO_REQUEST_TEXT } });
    const rb = await b.call(createRequestRoute, "/api/requests", {}, { body: { text: DEMO_REQUEST_TEXT } });
    expect([ra.status, rb.status]).toEqual([201, 201]);
    const [qa, qb] = await Promise.all([String(ra.body.id), String(rb.body.id)].map((id) => db().request.findUniqueOrThrow({ where: { id } })));
    expect(qa?.buyerId).not.toBe(qb?.buyerId);
  });

  it("/demo gives a visitor a fresh buyer and a pre-filled request; the admin gets the presenter's demo", async () => {
    const presenter = await db().buyer.create({ data: { ...DEMO_BUYER } });
    const visitor = await demoEntry(new Request("http://localhost:3000/demo"));
    expect(visitor.status).toBe(303);
    expect(visitor.headers.get("location")).toBe(`http://localhost:3000/buy?text=${encodeURIComponent(DEMO_REQUEST_TEXT)}`);
    expect(await db().buyer.count({ where: { email: DEMO_BUYER.email } })).toBe(2);

    const admin = await demoEntry(new Request("http://localhost:3000/demo", { headers: bearer }));
    expect(admin.headers.get("location")).toBe("http://localhost:3000/buy");
    expect(admin.headers.get("set-cookie")).toBe(buyerSessionCookie(presenter.id));
  });
});

describe("demo · the tracker links to the vendor's phone", () => {
  it("in DEMO_MODE for the buyer, never for the vendor or outside demo mode", async () => {
    const f = await makeOrderFixture();
    expect((await buildOrderView(f.order.id, "buyer")).vendorPhoneLink).toMatch(/^http:\/\/localhost:3000\/v\/[\w-]+$/);
    expect((await buildOrderView(f.order.id, "vendor")).vendorPhoneLink).toBeNull();
    setEnv({ DEMO_MODE: "false" });
    expect((await buildOrderView(f.order.id, "buyer")).vendorPhoneLink).toBeNull();
  });
});
