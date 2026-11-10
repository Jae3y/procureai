import { burnPasswordCheck, hashPassword, verifyPassword } from "@/lib/auth/password";
import { assertAcceptablePassword } from "@/lib/auth/password-policy";
import { newRecoveryCodes, newTotpSecret, normalizeRecoveryCode, otpauthUrl, verifyTotp } from "@/lib/auth/totp";
import { openSecret, randomToken, sealSecret, sha256Hex } from "@/lib/crypto";
import { db, transaction } from "@/lib/db";
import { env } from "@/lib/env";
import type { Account } from "@/lib/generated/prisma/client";
import { log } from "@/lib/log";
import { emailEnabled, sendEmail } from "@/lib/notify/email";
import { LEGAL_UPDATED } from "@/lib/legal";
import { notify, notifyOps } from "@/lib/notify/notifications";
import { DomainError } from "./errors";

/**
 * Accounts: email and password. Signing up never adopts an existing Buyer row with the same email,
 * because that row's email was never proven; every account gets its own buyer.
 */

const RESET_TTL_MS = 60 * 60 * 1000;
const VERIFY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type TokenPurpose = "RESET" | "VERIFY";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "P2002";
}

async function issueToken(accountId: string, purpose: TokenPurpose, ttlMs: number): Promise<string> {
  const token = randomToken();
  await db().$transaction([
    // Only the newest link of each kind works.
    db().accountToken.updateMany({ where: { accountId, purpose, usedAt: null }, data: { usedAt: new Date() } }),
    db().accountToken.create({ data: { accountId, purpose, tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + ttlMs) } }),
  ]);
  return token;
}

async function sendVerifyEmail(account: Pick<Account, "id" | "email">): Promise<boolean> {
  if (!emailEnabled()) return false;
  const token = await issueToken(account.id, "VERIFY", VERIFY_TTL_MS);
  return sendEmail({
    to: account.email,
    subject: "Confirm your email for ProcureAI",
    content: {
      heading: "Confirm your email",
      paragraphs: ["Confirm this is your email address so receipts, payment updates and password resets reach you."],
      button: { label: "Confirm my email", url: `${env().APP_BASE_URL}/verify?token=${token}` },
      footnote: "This link works for 7 days. If you didn't sign up for ProcureAI, ignore this email.",
    },
  });
}

/** "Send the link again", from the account page. Limited by the route so it can't be used to flood an inbox. */
export async function resendVerifyEmail(account: Account): Promise<{ sent: boolean }> {
  if (account.emailVerifiedAt) throw new DomainError("already_verified", "Your email is already confirmed.", 409);
  return { sent: await sendVerifyEmail(account) };
}

export async function signUp(input: { name: string; email: string; password: string }): Promise<Account> {
  const email = normalizeEmail(input.email);
  await assertAcceptablePassword(input.password, { email, name: input.name });
  const passwordHash = await hashPassword(input.password);
  try {
    const account = await transaction(async (tx) => {
      const buyer = await tx.buyer.create({ data: { name: input.name.trim(), email } });
      return tx.account.create({
        data: { email, name: input.name.trim(), passwordHash, buyerId: buyer.id, lastLoginAt: new Date(), termsAcceptedAt: new Date(), termsVersion: LEGAL_UPDATED },
      });
    });
    await sendVerifyEmail(account).catch((err: unknown) => log.error({ err }, "verification email failed"));
    return account;
  } catch (err) {
    if (isUniqueViolation(err)) throw new DomainError("email_taken", "There's already an account with this email. Sign in instead.", 409);
    throw err;
  }
}

const BAD_LOGIN = () => new DomainError("bad_login", "That email and password don't match.", 401);

export async function logIn(input: { email: string; password: string }): Promise<Account> {
  const account = await db().account.findUnique({ where: { email: normalizeEmail(input.email) } });
  if (!account?.passwordHash) {
    await burnPasswordCheck(input.password);
    throw BAD_LOGIN();
  }
  if (!(await verifyPassword(input.password, account.passwordHash))) throw BAD_LOGIN();
  return account;
}

/**
 * Google vouched for this email (email_verified), so: the Google-linked account if there is one;
 * otherwise the account with this email, now linked (Google proves the email, just as a reset link
 * would); otherwise a new account. A registered vendor profile with this email and no account yet is
 * linked too. Two-step sign-in, if on, is still asked for by the caller.
 */
export async function signInWithGoogle(profile: { sub: string; email: string; name: string }): Promise<Account> {
  const bySub = await db().account.findUnique({ where: { googleSub: profile.sub } });
  if (bySub) return bySub;
  const email = normalizeEmail(profile.email);
  const byEmail = await db().account.findUnique({ where: { email } });
  if (byEmail) {
    if (byEmail.googleSub && byEmail.googleSub !== profile.sub) {
      throw new DomainError("google_mismatch", "This email is already linked to a different Google account.", 409);
    }
    return db().account.update({ where: { id: byEmail.id }, data: { googleSub: profile.sub, emailVerifiedAt: byEmail.emailVerifiedAt ?? new Date() } });
  }
  const contact = await db().vendorContact.findFirst({ where: { email, isDemo: false, registeredAt: { not: null }, account: null } });
  try {
    return await transaction(async (tx) => {
      const buyer = await tx.buyer.create({ data: { name: profile.name, email } });
      return tx.account.create({
        data: {
          email,
          name: profile.name,
          buyerId: buyer.id,
          googleSub: profile.sub,
          emailVerifiedAt: new Date(),
          termsAcceptedAt: new Date(),
          termsVersion: LEGAL_UPDATED,
          ...(contact ? { vendorContactId: contact.id } : {}),
        },
      });
    });
  } catch (err) {
    // Two tabs finishing Google sign-in at once: the second finds the account the first created.
    if (isUniqueViolation(err)) {
      const again = await db().account.findUnique({ where: { googleSub: profile.sub } });
      if (again) return again;
    }
    throw err;
  }
}

/** The person passed every step: record it and tell them, so a sign-in they didn't make is noticed. */
export async function completeLogin(account: Account, device: { ip: string; userAgent: string | null }): Promise<Account> {
  const updated = await db().account.update({ where: { id: account.id }, data: { lastLoginAt: new Date() } });
  await notify(db(), {
    accountId: account.id,
    kind: "security.login",
    title: "New sign-in to your account",
    body: `${describeDevice(device.userAgent)}, from ${device.ip}. If this wasn't you, change your password now and sign out of all devices.`,
    href: "/account",
  });
  return updated;
}

function describeDevice(ua: string | null): string {
  if (!ua) return "An unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "A browser";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iPhone or iPad" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "an unknown system";
  return `${browser} on ${os}`;
}

// ── Two-step sign-in ───────────────────────────────────────────────────────

const BAD_CODE = () => new DomainError("bad_code", "That code isn't right. Use the 6-digit code your authenticator app shows now, or one of your recovery codes.", 401);

/**
 * Checks an authenticator code (or a recovery code, which then can't be used again). The update is
 * conditional on the previous state, so two requests racing with the same code can't both pass.
 */
export async function verifySecondFactor(account: Account, code: string): Promise<void> {
  if (!account.totpEnabledAt || !account.totpSecretCipher) throw BAD_CODE();
  const clean = code.trim();
  if (/^\d{6}$/.test(clean.replace(/\s+/g, ""))) {
    const step = verifyTotp(openSecret(account.id, account.totpSecretCipher), clean, account.totpLastStep);
    if (step === null) throw BAD_CODE();
    const { count } = await db().account.updateMany({ where: { id: account.id, totpLastStep: account.totpLastStep }, data: { totpLastStep: step } });
    if (count === 0) throw BAD_CODE();
    return;
  }
  const hash = sha256Hex(normalizeRecoveryCode(clean));
  if (!account.recoveryCodeHashes.includes(hash)) throw BAD_CODE();
  const remaining = account.recoveryCodeHashes.filter((h) => h !== hash);
  const { count } = await db().account.updateMany({ where: { id: account.id, recoveryCodeHashes: { has: hash } }, data: { recoveryCodeHashes: remaining } });
  if (count === 0) throw BAD_CODE();
  await notify(db(), {
    accountId: account.id,
    kind: "security.recovery",
    title: "A recovery code was used",
    body: `Someone signed in with one of your recovery codes. ${remaining.length} left. If this wasn't you, change your password now.`,
    href: "/account",
  });
}

export async function startTotpSetup(account: Account): Promise<{ secret: string; otpauth: string }> {
  if (account.totpEnabledAt) throw new DomainError("already_on", "Two-step sign-in is already on.", 409);
  const secret = newTotpSecret();
  await db().account.update({ where: { id: account.id }, data: { totpPendingCipher: sealSecret(account.id, secret) } });
  return { secret, otpauth: otpauthUrl(secret, account.email) };
}

/** The first correct code proves the app is set up. Returns the recovery codes, shown once. */
export async function confirmTotpSetup(account: Account, code: string): Promise<string[]> {
  if (!account.totpPendingCipher) throw new DomainError("no_setup", "Start two-step sign-in setup first.", 409);
  const secret = openSecret(account.id, account.totpPendingCipher);
  const step = verifyTotp(secret, code, null);
  if (step === null) throw BAD_CODE();
  const codes = newRecoveryCodes();
  await transaction(async (tx) => {
    await tx.account.update({
      where: { id: account.id },
      data: { totpSecretCipher: account.totpPendingCipher, totpPendingCipher: null, totpEnabledAt: new Date(), totpLastStep: step, recoveryCodeHashes: codes.map((c) => sha256Hex(c)) },
    });
    await notify(tx, { accountId: account.id, kind: "security.2fa", title: "Two-step sign-in is on", body: "Signing in now needs your password and a code from your authenticator app.", href: "/account" });
  });
  return codes;
}

export async function disableTotp(account: Account, password: string, code: string): Promise<void> {
  await requireCurrentPassword(account, password);
  await verifySecondFactor(account, code);
  await transaction(async (tx) => {
    await tx.account.update({ where: { id: account.id }, data: { totpSecretCipher: null, totpPendingCipher: null, totpEnabledAt: null, totpLastStep: null, recoveryCodeHashes: [] } });
    await notify(tx, { accountId: account.id, kind: "security.2fa", title: "Two-step sign-in was turned off", body: "If this wasn't you, change your password now and turn two-step sign-in back on.", href: "/account" });
  });
}

/** Ends every session, this one included. */
export async function signOutEverywhere(account: Account): Promise<void> {
  await db().account.update({ where: { id: account.id }, data: { sessionVersion: { increment: 1 } } });
}

/** A password change or reset also cancels a payout bank change that hasn't taken effect yet. */
async function cancelPendingBankChange(account: Pick<Account, "vendorContactId">): Promise<void> {
  if (!account.vendorContactId) return;
  await db().vendorContact.updateMany({
    where: { id: account.vendorContactId, pendingBankEffectiveAt: { not: null } },
    data: { pendingBankCode: null, pendingAccountNumber: null, pendingBankEffectiveAt: null },
  });
}

/**
 * Sends a reset link if the email belongs to an account. A registered vendor who has no account yet
 * gets one here: only the owner of the profile's email can open the link, so this is how a vendor
 * who registered before accounts existed takes over their own profile.
 * Always answers the same way, so nobody can use it to find out who has an account.
 */
export async function requestPasswordReset(rawEmail: string): Promise<void> {
  const email = normalizeEmail(rawEmail);
  let account = await db().account.findUnique({ where: { email } });
  if (!account) {
    const contact = await db().vendorContact.findFirst({ where: { email, isDemo: false, registeredAt: { not: null }, account: null } });
    if (!contact) return;
    account = await transaction(async (tx) => {
      const buyer = await tx.buyer.create({ data: { name: contact.businessName, email } });
      return tx.account.create({ data: { email, name: contact.businessName, buyerId: buyer.id, vendorContactId: contact.id } });
    });
  }
  const token = await issueToken(account.id, "RESET", RESET_TTL_MS);
  await sendEmail({
    to: account.email,
    subject: "Reset your ProcureAI password",
    content: {
      heading: "Reset your password",
      paragraphs: ["Someone asked to reset the password for your ProcureAI account. If it was you, choose a new password below."],
      button: { label: "Choose a new password", url: `${env().APP_BASE_URL}/reset?token=${token}` },
      footnote: "The link works once and expires in an hour. If you didn't ask for this, ignore this email: your password hasn't changed.",
    },
  });
}

async function consumeToken(token: string, purpose: TokenPurpose): Promise<string> {
  const row = await db().accountToken.findUnique({ where: { tokenHash: sha256Hex(token) } });
  const invalid = () => new DomainError("invalid_link", "This link has expired or was already used. Ask for a new one.", 400);
  if (!row || row.purpose !== purpose || row.expiresAt < new Date()) throw invalid();
  const { count } = await db().accountToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (count === 0) throw invalid();
  return row.accountId;
}

/** A reset proves the email too. Every existing session ends. */
/**
 * An emailed link alone can't take over an account with two-step sign-in: the reset also needs the
 * authenticator code or a recovery code. Someone who lost both has to go through support.
 */
export async function resetPassword(token: string, password: string, code?: string): Promise<Account> {
  const row = await db().accountToken.findUnique({ where: { tokenHash: sha256Hex(token) }, include: { account: true } });
  if (row && row.purpose === "RESET" && !row.usedAt && row.expiresAt > new Date()) {
    await assertAcceptablePassword(password, { email: row.account.email, name: row.account.name });
    if (row.account.totpEnabledAt) {
      if (!code) throw new DomainError("code_required", "This account has two-step sign-in. Enter the code from your authenticator app, or a recovery code.", 401, { issues: [{ path: "code", message: "Enter your authenticator or recovery code" }] });
      await verifySecondFactor(row.account, code);
    }
  }
  const accountId = await consumeToken(token, "RESET");
  const passwordHash = await hashPassword(password);
  const account = await db().account.update({
    where: { id: accountId },
    data: { passwordHash, sessionVersion: { increment: 1 }, emailVerifiedAt: new Date(), lastLoginAt: new Date() },
  });
  await cancelPendingBankChange(account);
  return account;
}

export async function verifyEmail(token: string): Promise<void> {
  const accountId = await consumeToken(token, "VERIFY");
  await db().account.update({ where: { id: accountId }, data: { emailVerifiedAt: new Date() } });
}

export async function requireCurrentPassword(account: Account, password: string): Promise<void> {
  if (!account.passwordHash) {
    throw new DomainError("no_password", "Your account signs in with Google. Set a password on your account page first, then try again.", 403);
  }
  if (!(await verifyPassword(password, account.passwordHash))) {
    throw new DomainError("wrong_password", "Your current password isn't right.", 403);
  }
}

/** How recently a password-less (Google) account must have signed in to set its first password. */
const RECENT_SIGN_IN_MS = 15 * 60 * 1000;

export async function changePassword(account: Account, current: string, next: string): Promise<Account> {
  if (account.passwordHash) {
    await requireCurrentPassword(account, current);
  } else if (!account.lastLoginAt || Date.now() - account.lastLoginAt.getTime() > RECENT_SIGN_IN_MS) {
    // Setting a first password is a takeover risk if a session was stolen: it needs a fresh Google sign-in.
    throw new DomainError("sign_in_again", "For your safety, sign out and sign in again with Google, then set your password within 15 minutes.", 403);
  }
  await assertAcceptablePassword(next, { email: account.email, name: account.name }, "next");
  const passwordHash = await hashPassword(next);
  const updated = await db().account.update({ where: { id: account.id }, data: { passwordHash, sessionVersion: { increment: 1 } } });
  await cancelPendingBankChange(updated);
  return updated;
}

export async function updateName(account: Account, name: string): Promise<void> {
  const clean = name.trim();
  await transaction(async (tx) => {
    await tx.account.update({ where: { id: account.id }, data: { name: clean } });
    await tx.buyer.update({ where: { id: account.buyerId }, data: { name: clean } });
  });
}

/**
 * Everything ProcureAI holds about this person, in a form they can keep. Bank details of other
 * parties and Kora's raw responses stay out: they aren't this person's data.
 */
export async function exportAccountData(account: Account) {
  const [requests, notifications, contact] = await Promise.all([
    db().request.findMany({
      where: { buyerId: account.buyerId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        rawText: true,
        item: true,
        quantity: true,
        budgetKobo: true,
        deadline: true,
        status: true,
        createdAt: true,
        order: { select: { id: true, number: true, amountKobo: true, amountPaidKobo: true, status: true, createdAt: true, messages: { where: { sender: "BUYER" }, select: { body: true, createdAt: true } } } },
      },
    }),
    db().notification.findMany({ where: { accountId: account.id }, orderBy: { createdAt: "asc" }, select: { title: true, body: true, createdAt: true, readAt: true } }),
    account.vendorContactId ? db().vendorContact.findUnique({ where: { id: account.vendorContactId } }) : null,
  ]);
  return {
    exportedAt: new Date().toISOString(),
    account: { email: account.email, name: account.name, createdAt: account.createdAt, emailVerifiedAt: account.emailVerifiedAt, lastLoginAt: account.lastLoginAt },
    vendorProfile: contact
      ? {
          businessName: contact.businessName,
          phone: contact.phone,
          sells: contact.category,
          city: contact.city,
          rcNumber: contact.rcNumber,
          bankCode: contact.bankCode,
          // Masked: a stolen session shouldn't be able to download full bank details.
          accountNumber: contact.accountNumber ? `••••••${contact.accountNumber.slice(-4)}` : null,
          email: contact.email,
          registeredAt: contact.registeredAt,
        }
      : null,
    requests,
    notifications,
  };
}

/**
 * Asking for deletion flags the account for a person to act on. Payment records have to be kept for
 * the legally required period, so this can't simply erase rows; the admin console lists the request.
 */
export async function requestDeletion(account: Account): Promise<void> {
  await db().account.update({ where: { id: account.id }, data: { deletionRequestedAt: new Date() } });
  await notifyOps(db(), { kind: "ops.deletion", title: "An account asked to be deleted", body: `${account.email} asked for their account to be deleted. Review it in the admin console.`, href: "/admin" });
  log.warn({ accountId: account.id }, "account deletion requested");
}
