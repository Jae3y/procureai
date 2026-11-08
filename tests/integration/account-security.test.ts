import { describe, expect, it } from "vitest";
import { POST as twoFaConfirm } from "@/app/api/account/2fa/confirm/route";
import { POST as twoFaSetup } from "@/app/api/account/2fa/setup/route";
import { POST as passwordPost } from "@/app/api/account/password/route";
import { POST as signoutAll } from "@/app/api/account/signout-all/route";
import { POST as loginPost } from "@/app/api/auth/login/route";
import { POST as loginVerify } from "@/app/api/auth/login/verify/route";
import { POST as resetPost } from "@/app/api/auth/reset/route";
import { POST as signupPost } from "@/app/api/auth/signup/route";
import { POST as vendorProfilePost } from "@/app/api/vendor/profile/route";
import { POST as registerPost } from "@/app/api/vendors/register/route";
import { currentStep, totpCode } from "@/lib/auth/totp";
import { sha256Hex } from "@/lib/crypto";
import { db } from "@/lib/db";
import { applyDueBankChange } from "@/lib/domain/vendor-profiles";
import { accountFrom } from "@/lib/http/session";
import { useKoraDouble } from "../helpers/kora";

useKoraDouble();

type Handler<P extends Record<string, string>> = (req: Request, ctx: { params: Promise<P> }) => Promise<Response>;

class Browser {
  jar = new Map<string, string>();
  async call<P extends Record<string, string>>(handler: Handler<P>, path: string, params: P, body?: unknown) {
    const headers: Record<string, string> = { "content-type": "application/json", "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0" };
    if (this.jar.size) headers.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await handler(new Request(`http://localhost:3000${path}`, { method: "POST", headers, body: JSON.stringify(body ?? {}) }), { params: Promise.resolve(params) });
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(";");
      const [k, ...v] = (pair ?? "").split("=");
      if (!k) continue;
      if (attrs.some((a) => a.trim() === "Max-Age=0")) this.jar.delete(k);
      else this.jar.set(k, v.join("="));
    }
    return { status: res.status, body: (await res.json()) as Record<string, unknown> & { error?: { code: string } } };
  }
  signedIn() {
    return accountFrom(new Request("http://localhost:3000/", { headers: { cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ") } }));
  }
}

const PASSWORD = "a long and unusual passphrase";

/** Signs up, turns two-step sign-in on, and returns the secret and recovery codes. */
async function withTwoStep(email: string) {
  const b = new Browser();
  expect((await b.call(signupPost, "/api/auth/signup", {}, { name: "Ada Obi", email, password: PASSWORD })).status).toBe(201);
  const setup = await b.call(twoFaSetup, "/api/account/2fa/setup", {}, {});
  expect(String(setup.body.qrSvg)).toContain("<svg");
  const secret = String(setup.body.secret);
  const confirmed = await b.call(twoFaConfirm, "/api/account/2fa/confirm", {}, { code: totpCode(secret, currentStep()) });
  expect(confirmed.status).toBe(200);
  const recoveryCodes = confirmed.body.recoveryCodes as string[];
  expect(recoveryCodes).toHaveLength(10);
  const stored = await db().account.findUniqueOrThrow({ where: { email } });
  expect(stored.totpSecretCipher).not.toContain(secret); // sealed, not stored as typed
  expect(stored.recoveryCodeHashes).not.toContain(recoveryCodes[0]);
  return { b, secret, recoveryCodes };
}

describe("password rules", () => {
  it("refuses common passwords and passwords built from the person's own name or email", async () => {
    for (const password of ["password123", "adaobi-2026-secret", "kemi.adeyemi99", "aaaaaaaaaaaa"]) {
      const r = await new Browser().call(signupPost, "/api/auth/signup", {}, { name: "Ada Obi", email: "kemi.adeyemi@example.com", password });
      expect(r.body.error?.code, password).toBe("weak_password");
    }
  });
});

describe("two-step sign-in", () => {
  it("a correct password alone doesn't sign in; the code does, once, and the sign-in is reported", async () => {
    const { secret } = await withTwoStep("two@example.com");
    const b = new Browser();
    const first = await b.call(loginPost, "/api/auth/login", {}, { email: "two@example.com", password: PASSWORD });
    expect(first.body).toMatchObject({ twoFactor: true });
    expect(await b.signedIn()).toBeNull();

    expect((await b.call(loginVerify, "/api/auth/login/verify", {}, { code: "000000" })).body.error?.code).toBe("bad_code");
    // The setup already used the current step, so the next one is what the app shows next.
    const next = totpCode(secret, currentStep() + 1);
    expect((await b.call(loginVerify, "/api/auth/login/verify", {}, { code: next })).status).toBe(200);
    expect(await b.signedIn()).not.toBeNull();

    const replay = new Browser();
    await replay.call(loginPost, "/api/auth/login", {}, { email: "two@example.com", password: PASSWORD });
    expect((await replay.call(loginVerify, "/api/auth/login/verify", {}, { code: next })).body.error?.code).toBe("bad_code");

    const account = await db().account.findUniqueOrThrow({ where: { email: "two@example.com" } });
    const alert = await db().notification.findFirstOrThrow({ where: { accountId: account.id, kind: "security.login" } });
    expect(alert.body).toContain("Chrome on Windows");
  });

  it("the verify step needs the password step first", async () => {
    expect((await new Browser().call(loginVerify, "/api/auth/login/verify", {}, { code: "123456" })).body.error?.code).toBe("ticket_expired");
  });

  it("a recovery code works exactly once", async () => {
    const { recoveryCodes } = await withTwoStep("rec@example.com");
    const code = recoveryCodes[0] ?? "";
    const a = new Browser();
    await a.call(loginPost, "/api/auth/login", {}, { email: "rec@example.com", password: PASSWORD });
    expect((await a.call(loginVerify, "/api/auth/login/verify", {}, { code: code.toUpperCase() })).status).toBe(200);
    const b = new Browser();
    await b.call(loginPost, "/api/auth/login", {}, { email: "rec@example.com", password: PASSWORD });
    expect((await b.call(loginVerify, "/api/auth/login/verify", {}, { code })).body.error?.code).toBe("bad_code");
  });

  it("an emailed reset link alone can't take over an account with two-step sign-in", async () => {
    const { secret } = await withTwoStep("reset2@example.com");
    const account = await db().account.findUniqueOrThrow({ where: { email: "reset2@example.com" } });
    const token = "reset-token-two-step-0123456789abcdef";
    await db().accountToken.create({ data: { accountId: account.id, purpose: "RESET", tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + 60_000) } });
    const noCode = await new Browser().call(resetPost, "/api/auth/reset", {}, { token, password: "a different long passphrase" });
    expect(noCode.body.error?.code).toBe("code_required");
    const ok = await new Browser().call(resetPost, "/api/auth/reset", {}, { token, password: "a different long passphrase", code: totpCode(secret, currentStep() + 1) });
    expect(ok.status).toBe(200);
  });

  it("signing out of all devices ends every session", async () => {
    const { b } = await withTwoStep("everywhere@example.com");
    const other = new Browser();
    other.jar = new Map(b.jar);
    expect((await b.call(signoutAll, "/api/account/signout-all", {}, {})).status).toBe(200);
    expect(await other.signedIn()).toBeNull();
    expect(await b.signedIn()).toBeNull();
  });
});

describe("changing where a vendor's money goes", () => {
  const PROFILE = { businessName: "Owerri Prints Ltd", phone: "0803 555 0101", sells: "T-shirts, printing", city: "Owerri", rcNumber: "RC00000011", bankCode: "058", accountNumber: "0123456789", email: "bank@owerriprints.example", consent: true };
  const EDIT = { businessName: "Owerri Prints Ltd", sells: "printing", city: "Owerri", rcNumber: "RC00000011", bankCode: "058", email: "bank@owerriprints.example" };

  it("needs two-step sign-in and a code, waits 24 hours, and a password change cancels it", async () => {
    const b = new Browser();
    const reg = await b.call(registerPost, "/api/vendors/register", {}, { ...PROFILE, password: PASSWORD });
    const contactId = String(reg.body.id);

    const without = await b.call(vendorProfilePost, "/api/vendor/profile", {}, { ...EDIT, accountNumber: "9876543210", password: PASSWORD });
    expect(without.body.error?.code).toBe("two_step_required");

    const setup = await b.call(twoFaSetup, "/api/account/2fa/setup", {}, {});
    const secret = String(setup.body.secret);
    await b.call(twoFaConfirm, "/api/account/2fa/confirm", {}, { code: totpCode(secret, currentStep()) });

    expect((await b.call(vendorProfilePost, "/api/vendor/profile", {}, { ...EDIT, accountNumber: "9876543210", password: PASSWORD })).body.error?.code).toBe("code_required");
    const changed = await b.call(vendorProfilePost, "/api/vendor/profile", {}, { ...EDIT, accountNumber: "9876543210", password: PASSWORD, code: totpCode(secret, currentStep() + 1) });
    expect(changed.status).toBe(200);
    expect(changed.body.bankChangeEffectiveAt).toBeTruthy();

    let contact = await db().vendorContact.findUniqueOrThrow({ where: { id: contactId } });
    expect(contact.accountNumber).toBe("0123456789"); // still the old account
    expect(contact.pendingAccountNumber).toBe("9876543210");

    // Not yet due: nothing moves.
    await applyDueBankChange(contactId);
    expect((await db().vendorContact.findUniqueOrThrow({ where: { id: contactId } })).accountNumber).toBe("0123456789");

    // The owner notices and changes the password: the pending change is cancelled.
    expect((await b.call(passwordPost, "/api/account/password", {}, { current: PASSWORD, next: "another long passphrase here" })).status).toBe(200);
    contact = await db().vendorContact.findUniqueOrThrow({ where: { id: contactId } });
    expect(contact.pendingAccountNumber).toBeNull();
    expect(contact.accountNumber).toBe("0123456789");
  });

  it("a due change moves into place", async () => {
    const b = new Browser();
    const reg = await b.call(registerPost, "/api/vendors/register", {}, { ...PROFILE, phone: "0803 555 0102", email: "due@owerriprints.example", password: PASSWORD });
    const contactId = String(reg.body.id);
    await db().vendorContact.update({ where: { id: contactId }, data: { pendingBankCode: "058", pendingAccountNumber: "1112223334", pendingBankEffectiveAt: new Date(Date.now() - 1_000) } });
    await applyDueBankChange(contactId);
    const contact = await db().vendorContact.findUniqueOrThrow({ where: { id: contactId } });
    expect(contact.accountNumber).toBe("1112223334");
    expect(contact.pendingBankEffectiveAt).toBeNull();
  });
});
