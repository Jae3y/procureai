import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetEnvCache } from "@/lib/env";
import { buyerSessionCookie } from "@/lib/http/session";
import { buildRecordView } from "@/lib/views/record-view";
import type { Thread } from "@/lib/views/thread-view";
import { GET as buyerGet, POST as buyerPost } from "@/app/api/orders/[id]/messages/route";
import { GET as vendorGet, POST as vendorPost } from "@/app/api/vendors/[token]/messages/route";
import { makeBuyer, makeOrderFixture, makeVendor } from "../helpers/factories";

const BASE = "http://localhost:3000";

// As deployed: DEMO_MODE with an ADMIN_TOKEN, so admin is not open to every visitor.
function setEnv(vars: Record<string, string>) {
  Object.assign(process.env, vars);
  resetEnvCache();
}
beforeEach(() => setEnv({ ADMIN_TOKEN: "messages-test-admin-token-0123456789" }));
afterEach(() => setEnv({ ADMIN_TOKEN: "" }));

function cookieFor(buyerId: string) {
  return { cookie: buyerSessionCookie(buyerId).split(";")[0] ?? "" };
}

/** Gives a vendor a known invite token (the factory stores only a hash of a random one). */
async function tokenFor(vendorId: string, token: string) {
  await db().vendor.update({ where: { id: vendorId }, data: { inviteTokenHash: createHash("sha256").update(token).digest("hex") } });
  return token;
}

async function call<P extends Record<string, string>>(handler: (req: Request, ctx: { params: Promise<P> }) => Promise<Response>, url: string, params: P, init: RequestInit = {}) {
  const res = await handler(new Request(`${BASE}${url}`, init), { params: Promise.resolve(params) });
  return { status: res.status, body: (await res.json()) as Thread & { error?: { code: string; message: string } } };
}

const post = (text: string, headers: Record<string, string> = {}): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify({ text }),
});

describe("buyer–vendor message thread", () => {
  it("lets the buyer and the chosen vendor write to each other, newest last, with who and when", async () => {
    const f = await makeOrderFixture({ amountKobo: 84_000_000n });
    const token = await tokenFor(f.vendor.id, "vendorTokenForMessagesTest01");
    const buyer = cookieFor(f.request.buyerId);
    const url = `/api/orders/${f.order.id}/messages`;

    const empty = await call(buyerGet, url, { id: f.order.id }, { headers: buyer });
    expect(empty.status).toBe(200);
    expect(empty.body.messages).toEqual([]);
    expect(empty.body.maxChars).toBe(300);

    const b1 = await call(buyerPost, url, { id: f.order.id }, post("  Can you deliver to Ikeja?  ", buyer));
    expect(b1.status).toBe(201);
    expect(b1.body.messages).toHaveLength(1);
    expect(b1.body.messages[0]).toMatchObject({ from: "buyer", who: "You", text: "Can you deliver to Ikeja?", mine: true });

    const v1 = await call(vendorPost, `/api/vendors/${token}/messages`, { token }, post("Yes, Thursday morning."));
    expect(v1.status).toBe(201);

    // The vendor sees both, from their side; the buyer is named.
    const vendorView = await call(vendorGet, `/api/vendors/${token}/messages`, { token });
    expect(vendorView.body.with).toBe("Tolu Adebayo");
    expect(vendorView.body.messages.map((m) => [m.who, m.text, m.mine])).toEqual([
      ["Tolu Adebayo", "Can you deliver to Ikeja?", false],
      ["You", "Yes, Thursday morning.", true],
    ]);
    expect(vendorView.body.messages[0]?.when).toMatch(/^\d{1,2} \w+, /);

    // The buyer's poll asks only for what is newer than the last message it has.
    const after = b1.body.messages[0]?.id ?? "";
    const poll = await call(buyerGet, `${url}?after=${after}`, { id: f.order.id }, { headers: buyer });
    expect(poll.body.messages.map((m) => [m.who, m.text])).toEqual([[f.vendor.name, "Yes, Thursday morning."]]);

    // The record shows only how many messages there were.
    expect((await buildRecordView(f.order.id)).messages).toEqual({ count: 2, line: "2 messages between buyer and vendor." });
  });

  it("keeps the thread to the two parties", async () => {
    const f = await makeOrderFixture();
    const stranger = await makeBuyer();
    const url = `/api/orders/${f.order.id}/messages`;
    expect((await call(buyerGet, url, { id: f.order.id }, { headers: cookieFor(stranger.id) })).status).toBe(403);
    expect((await call(buyerPost, url, { id: f.order.id }, post("hello", cookieFor(stranger.id)))).status).toBe(403);
    expect((await call(buyerPost, url, { id: f.order.id }, post("hello"))).status).toBe(403);

    // A vendor who quoted but was not chosen has no thread.
    const other = await makeVendor(f.request.id, { label: "Vendor C" });
    const otherToken = await tokenFor(other.id, "notChosenVendorToken000000001");
    const res = await call(vendorPost, `/api/vendors/${otherToken}/messages`, { token: otherToken }, post("pick me"));
    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe("no_order");
    expect(await db().orderMessage.count()).toBe(0);
  });

  it("refuses empty and over-long messages, in the API and in the database", async () => {
    const f = await makeOrderFixture();
    const buyer = cookieFor(f.request.buyerId);
    const url = `/api/orders/${f.order.id}/messages`;
    expect((await call(buyerPost, url, { id: f.order.id }, post("   ", buyer))).body.error?.code).toBe("empty_message");
    expect((await call(buyerPost, url, { id: f.order.id }, post("x".repeat(301), buyer))).body.error?.code).toBe("message_too_long");
    expect((await call(buyerPost, url, { id: f.order.id }, post("x".repeat(300), buyer))).status).toBe(201);
    await expect(db().orderMessage.create({ data: { orderId: f.order.id, sender: "VENDOR", body: "y".repeat(301) } })).rejects.toThrow();
    await expect(db().orderMessage.create({ data: { orderId: f.order.id, sender: "VENDOR", body: "  " } })).rejects.toThrow();
  });
});
