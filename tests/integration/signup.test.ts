import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as signupPost } from "@/app/api/auth/signup/route";
import { verifyTurnstile } from "@/lib/auth/turnstile";
import { db } from "@/lib/db";
import { resetEnvCache } from "@/lib/env";
import { signupBody } from "../helpers/signup";

type Body = { error?: { code: string; details?: { issues?: Array<{ path: string; message: string }> } }; ok?: boolean; intent?: string };

async function post(body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: Body }> {
  const res = await signupPost(
    new Request("http://localhost:3000/api/auth/signup", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }),
    { params: Promise.resolve({}) },
  );
  return { status: res.status, body: (await res.json()) as Body };
}

afterEach(() => {
  Object.assign(process.env, { TURNSTILE_SITE_KEY: "", TURNSTILE_SECRET_KEY: "" });
  resetEnvCache();
  vi.unstubAllGlobals();
});

describe("sign-up", () => {
  it("saves who they are and what they'll do: name, normalised phone, intent, organisation, source", async () => {
    const r = await post(signupBody({ email: "full@example.com", phone: "08031234567", intent: "SELL", organisation: "Owerri Prints", heardFrom: "WHATSAPP" }));
    expect(r.status).toBe(201);
    expect(r.body.intent).toBe("SELL");
    const a = await db().account.findUniqueOrThrow({ where: { email: "full@example.com" } });
    expect(a).toMatchObject({ name: "Ada Obi", phone: "+234 803 123 4567", intent: "SELL", organisation: "Owerri Prints", heardFrom: "WHATSAPP" });
    expect(a.termsAcceptedAt).not.toBeNull();
    expect(a.marketingConsentAt).toBeNull(); // never opted in unless they tick it
  });

  it("records marketing consent only when they tick it", async () => {
    await post(signupBody({ email: "yes@example.com", marketingOptIn: true }));
    expect((await db().account.findUniqueOrThrow({ where: { email: "yes@example.com" } })).marketingConsentAt).not.toBeNull();
  });

  it("refuses a phone number that isn't a Nigerian mobile, on the phone field", async () => {
    const r = await post(signupBody({ phone: "12345" }));
    expect(r.status).toBe(400);
    expect(r.body.error?.details?.issues?.[0]?.path).toBe("phone");
  });

  it("needs the terms ticked and an intent chosen", async () => {
    expect((await post(signupBody({ acceptTerms: false }))).body.error?.details?.issues?.some((i) => i.path === "acceptTerms")).toBe(true);
    const noIntent = signupBody();
    delete noIntent.intent;
    expect((await post(noIntent)).body.error?.details?.issues?.some((i) => i.path === "intent")).toBe(true);
  });

  it("turns away bots: a filled honeypot, and a form posted faster than a person could fill it", async () => {
    expect((await post(signupBody({ website: "http://spam.example" }))).status).toBe(400);
    const fast = await post(signupBody({ openedAt: Date.now() - 500 }));
    expect(fast).toMatchObject({ status: 400, body: { error: { code: "too_fast" } } });
    expect(await db().account.count()).toBe(0);
  });

  it("with the bot check switched on, a missing or failed token is refused", async () => {
    Object.assign(process.env, { TURNSTILE_SITE_KEY: "site-key", TURNSTILE_SECRET_KEY: "secret-key" });
    resetEnvCache();
    const none = await post(signupBody());
    expect(none).toMatchObject({ status: 400, body: { error: { code: "bot_check_failed" } } });

    const ok = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
    await expect(verifyTurnstile("good-token", "1.2.3.4", ok as unknown as typeof fetch)).resolves.toBeUndefined();
    const sent = (ok.mock.calls[0] as unknown as [string, { body: string }])[1].body;
    expect(sent).toContain("response=good-token");
    expect(sent).toContain("remoteip=1.2.3.4");

    const bad = vi.fn(async () => new Response(JSON.stringify({ success: false }), { status: 200 }));
    await expect(verifyTurnstile("bad-token", "1.2.3.4", bad as unknown as typeof fetch)).rejects.toMatchObject({ code: "bot_check_failed" });
    const down = vi.fn(async () => {
      throw new Error("network down");
    });
    await expect(verifyTurnstile("t", "1.2.3.4", down as unknown as typeof fetch)).rejects.toMatchObject({ code: "bot_check_failed" });
  });
});
