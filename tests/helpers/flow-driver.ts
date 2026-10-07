import { expect } from "vitest";
import { POST as approveRoute } from "@/app/api/requests/[id]/approve/route";
import { POST as inviteRoute } from "@/app/api/requests/[id]/invite/route";
import { POST as recommendRoute } from "@/app/api/requests/[id]/recommend/route";
import { GET as requestGet } from "@/app/api/requests/[id]/route";
import { POST as verifyRoute } from "@/app/api/requests/[id]/verify/route";
import { POST as createRequestRoute } from "@/app/api/requests/route";
import { POST as handoverRoute } from "@/app/api/orders/[id]/handover/route";
import { POST as recheckRoute } from "@/app/api/orders/[id]/recheck/route";
import { GET as orderGet } from "@/app/api/orders/[id]/route";
import { POST as quoteRoute } from "@/app/api/vendors/[token]/quote/route";
import { inviteTokenFor } from "@/lib/crypto";
import { db } from "@/lib/db";
import { DEMO_VENDORS } from "@/lib/demo/script";
import { revealHandoverCode } from "@/lib/domain/handover";
import type { OrderView } from "@/lib/views/order-view";
import type { RequestView } from "@/lib/views/request-view";

/**
 * Drives the whole purchase through the real HTTP route handlers, as a browser and a phone would.
 * Shared by the integration run (Kora test double) and the sandbox run (real Kora).
 */

type Json = Record<string, unknown>;
const BASE = "http://localhost:3000";

export class FlowDriver {
  cookie = "";

  async call<P extends Record<string, string>>(
    handler: (req: Request, ctx: { params: Promise<P> }) => Promise<Response>,
    path: string,
    params: P,
    opts: { method?: string; body?: unknown; idempotencyKey?: string } = {},
  ): Promise<{ status: number; body: Json; headers: Headers }> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.cookie) headers.cookie = this.cookie;
    if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
    const res = await handler(
      new Request(`${BASE}${path}`, { method: opts.method ?? "POST", headers, ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}) }),
      { params: Promise.resolve(params) },
    );
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0] ?? "";
    return { status: res.status, body: (await res.json()) as Json, headers: res.headers };
  }

  async seedDirectory(): Promise<void> {
    for (const v of DEMO_VENDORS) {
      await db().vendorContact.upsert({ where: { phone: v.phone }, create: { businessName: v.businessName, phone: v.phone, category: v.category, city: v.city }, update: {} });
    }
  }

  async createAndQuote(): Promise<string> {
    const created = await this.call(createRequestRoute, "/api/requests", {}, {
      body: { text: "300 branded T-shirts, under ₦1.5m, delivered by 23 October", buyerName: "Tolu Adebayo", buyerEmail: "tolu.adebayo@example.com" },
    });
    expect(created.status).toBe(201);
    const requestId = String(created.body.id);

    expect((await this.call(inviteRoute, `/api/requests/${requestId}/invite`, { id: requestId }, { body: {} })).status).toBe(201);
    const ask = { item: "Branded T-shirts", quantity: 300, budgetKobo: 150_000_000n };
    for (const [i, v] of DEMO_VENDORS.entries()) {
      const token = inviteTokenFor(requestId, `Vendor ${String.fromCharCode(65 + i)}`);
      const r = await this.call(quoteRoute, `/api/vendors/${token}/quote`, { token }, {
        body: { reply: v.reply(ask), businessName: v.businessName, rcNumber: v.rcNumber, bankCode: v.bankCode, accountNumber: v.accountNumber, email: v.email, consent: true },
      });
      expect(r.status).toBe(201);
    }
    return requestId;
  }

  async verifyAndRecommend(requestId: string): Promise<RequestView> {
    const v = await this.call(verifyRoute, `/api/requests/${requestId}/verify`, { id: requestId }, { body: {} });
    expect(v.status, JSON.stringify(v.body)).toBe(200);
    const r = await this.call(recommendRoute, `/api/requests/${requestId}/recommend`, { id: requestId }, { body: {} });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return (await this.call(requestGet, `/api/requests/${requestId}`, { id: requestId }, { method: "GET" })).body as unknown as RequestView;
  }

  async approveTwice(requestId: string): Promise<{ orderId: string; replayed: boolean }> {
    const key = `approve-${requestId}`;
    const [a, b] = await Promise.all([
      this.call(approveRoute, `/api/requests/${requestId}/approve`, { id: requestId }, { body: {}, idempotencyKey: key }),
      this.call(approveRoute, `/api/requests/${requestId}/approve`, { id: requestId }, { body: {}, idempotencyKey: key }),
    ]);
    const ok = [a, b].filter((r) => r.status === 201);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    for (const r of [a, b]) expect([201, 409]).toContain(r.status); // 409 = first still running
    const again = await this.call(approveRoute, `/api/requests/${requestId}/approve`, { id: requestId }, { body: {}, idempotencyKey: key });
    expect(again.status).toBe(201);
    expect(again.headers.get("idempotent-replay")).toBe("true");
    return { orderId: String(ok[0]?.body.orderId), replayed: true };
  }

  async order(orderId: string): Promise<OrderView> {
    return (await this.call(orderGet, `/api/orders/${orderId}`, { id: orderId }, { method: "GET" })).body as unknown as OrderView;
  }

  async recheck(orderId: string): Promise<void> {
    const r = await this.call(recheckRoute, `/api/orders/${orderId}/recheck`, { id: orderId }, { body: {} });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  }

  async enterCode(orderId: string, requestId: string, code: string): Promise<{ status: number; body: Json }> {
    const token = inviteTokenFor(requestId, "Vendor B");
    return this.call(handoverRoute, `/api/orders/${orderId}/handover`, { id: orderId }, { body: { token, code } });
  }

  async buyerCode(orderId: string): Promise<string> {
    return revealHandoverCode(await db().order.findUniqueOrThrow({ where: { id: orderId } })) ?? "";
  }
}
