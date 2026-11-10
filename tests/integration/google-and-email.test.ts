import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as approvePost } from "@/app/api/requests/[id]/approve/route";
import { db } from "@/lib/db";
import { changePassword, requestDeletion, requireCurrentPassword, signInWithGoogle, signUp } from "@/lib/domain/accounts";
import { createRequest } from "@/lib/domain/requests";
import { resetEnvCache } from "@/lib/env";
import { accountSessionCookie } from "@/lib/http/session";
import { renderEmail } from "@/lib/notify/email-template";
import { useKoraDouble } from "../helpers/kora";

useKoraDouble();

function setEnv(vars: Record<string, string>) {
  Object.assign(process.env, vars);
  resetEnvCache();
}

afterEach(() => {
  setEnv({ RESEND_API_KEY: "", OPS_ALERT_EMAIL: "" });
  vi.unstubAllGlobals();
});

const GOOGLE = { sub: "google-sub-1", email: "ada@example.com", name: "Ada Obi" };

describe("Continue with Google", () => {
  it("a new person gets an account with a confirmed email and no password", async () => {
    const a = await signInWithGoogle(GOOGLE);
    expect(a).toMatchObject({ email: "ada@example.com", googleSub: "google-sub-1", passwordHash: null });
    expect(a.emailVerifiedAt).not.toBeNull();
    expect((await signInWithGoogle(GOOGLE)).id).toBe(a.id); // same Google account, same ProcureAI account
  });

  it("links to an existing account with the same email, which Google has proven", async () => {
    const existing = await signUp({ name: "Ada Obi", email: "ada@example.com", password: "a long unusual passphrase" });
    const viaGoogle = await signInWithGoogle(GOOGLE);
    expect(viaGoogle.id).toBe(existing.id);
    expect(viaGoogle.googleSub).toBe("google-sub-1");
  });

  it("refuses a second, different Google account for an email that's already linked", async () => {
    await signInWithGoogle(GOOGLE);
    await expect(signInWithGoogle({ ...GOOGLE, sub: "google-sub-2" })).rejects.toMatchObject({ code: "google_mismatch" });
  });

  it("links a registered vendor profile with the same email", async () => {
    const contact = await db().vendorContact.create({
      data: { businessName: "Owerri Prints", phone: "+234 803 555 0111", category: "printing", city: "Owerri", registeredAt: new Date(), rcNumber: "RC00000011", bankCode: "058", accountNumber: "0123456789", email: "ada@example.com" },
    });
    expect((await signInWithGoogle(GOOGLE)).vendorContactId).toBe(contact.id);
  });

  it("a Google-only account sets a first password only right after signing in", async () => {
    const a = await signInWithGoogle(GOOGLE);
    await expect(requireCurrentPassword(a, "anything")).rejects.toMatchObject({ code: "no_password" });
    const stale = await db().account.update({ where: { id: a.id }, data: { lastLoginAt: new Date(Date.now() - 60 * 60 * 1000) } });
    await expect(changePassword(stale, "", "a fresh long passphrase")).rejects.toMatchObject({ code: "sign_in_again" });
    const fresh = await db().account.update({ where: { id: a.id }, data: { lastLoginAt: new Date() } });
    const updated = await changePassword(fresh, "", "a fresh long passphrase");
    expect(updated.passwordHash).toMatch(/^scrypt\$/);
  });
});

describe("email", () => {
  it("renders branded HTML with everything escaped, and a plain-text twin", () => {
    const { html, text } = renderEmail({ heading: "Hi <script>", paragraphs: ["A & B"], button: { label: "Open", url: "https://procureai.com.ng/x?a=1&b=2" } });
    expect(html).toContain("Hi &lt;script&gt;");
    expect(html).toContain("A &amp; B");
    expect(html).not.toContain("<script>");
    expect(text).toContain("Open: https://procureai.com.ng/x?a=1&b=2");
    expect(text).toContain("PROCUREAI TECHNOLOGIES (RC 99763666)");
  });

  it("once email works, a real purchase can't be paid for until the email is confirmed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    setEnv({ RESEND_API_KEY: "re_test_only_not_a_real_key" });
    const account = await signUp({ name: "Kemi Ade", email: "kemi@example.com", password: "a long unusual passphrase" });
    const request = await createRequest({ rawText: "300 branded T-shirts, under ₦1.5m, delivered by 23 December", buyerId: account.buyerId, isDemo: false });
    const cookie = accountSessionCookie(account).split(";")[0] ?? "";
    const res = await approvePost(
      new Request(`http://localhost:3000/api/requests/${request.id}/approve`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: "{}" }),
      { params: Promise.resolve({ id: request.id }) },
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("email_unconfirmed");
  });

  it("the owner is alerted when someone asks to delete their account", async () => {
    const owner = await signUp({ name: "Jackson Owner", email: "owner@example.com", password: "a long unusual passphrase" });
    setEnv({ OPS_ALERT_EMAIL: "Owner@Example.com" });
    const someone = await signUp({ name: "Tunde Bello", email: "tunde@example.com", password: "a long unusual passphrase" });
    await requestDeletion(someone);
    const alert = await db().notification.findFirstOrThrow({ where: { accountId: owner.id, kind: "ops.deletion" } });
    expect(alert.body).toContain("tunde@example.com");
  });
});
