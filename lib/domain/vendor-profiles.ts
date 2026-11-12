import { db, transaction } from "@/lib/db";
import type { Account } from "@/lib/generated/prisma/client";
import { claimFoundingSpot } from "@/lib/founding";
import { notify } from "@/lib/notify/notifications";
import { DomainError } from "./errors";

/**
 * Vendors who register on ProcureAI once. Their profile joins the directory that sourcing searches,
 * and their quotes reuse the saved business details, so a quote is just the reply in their own words.
 * Registration never replaces Kora: every vendor is still verified on every purchase they're chosen for.
 *
 * A profile can't be overwritten through this form, because a second sign-up with the same phone could
 * otherwise redirect someone else's payouts. Changing details needs the account's password
 * (updateVendorProfile), and tells the account's email address that it happened.
 */

export type VendorRegistration = {
  businessName: string;
  phone: string;
  sells: string;
  city: string;
  /** Optional. Without it, the bank account is checked against ownerName instead. */
  rcNumber?: string | undefined;
  ownerName?: string | undefined;
  bankCode: string;
  accountNumber: string;
  email: string;
  consent: boolean;
};

/** "08034127781", "2348034127781", "+234 803 412 7781" → "+234 803 412 7781". */
export function normalizeNigerianPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  const local = digits.startsWith("234") ? digits.slice(3) : digits.startsWith("0") ? digits.slice(1) : digits;
  if (!/^[789]\d{9}$/.test(local)) throw new DomainError("phone_invalid", "Use a Nigerian mobile number, e.g. 0803 412 7781.", 400);
  return `+234 ${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`;
}

export async function registerVendor(input: VendorRegistration): Promise<{ id: string; businessName: string; foundingNumber: number | null }> {
  if (!input.consent) throw new DomainError("consent_required", "Tick the box to let ProcureAI check your business and bank account.", 400);
  const phone = normalizeNigerianPhone(input.phone);
  const profile = {
    businessName: input.businessName.trim(),
    category: input.sells.trim().toLowerCase().replace(/[,;/]+/g, " ").replace(/\s+/g, " "),
    city: input.city.trim(),
    rcNumber: (input.rcNumber ?? "").trim().toUpperCase().replace(/\s+/g, "") || null,
    ownerName: input.ownerName?.trim() || null,
    bankCode: input.bankCode.trim(),
    accountNumber: input.accountNumber.trim(),
    email: input.email.trim().toLowerCase(),
    registeredAt: new Date(),
  };
  const taken = () => new DomainError("already_registered", "This phone number is already registered on ProcureAI. Sign in to change your details.", 409);
  const existing = await db().vendorContact.findUnique({ where: { phone } });
  if (existing) {
    // Only an unregistered directory entry can be claimed, and only once (the WHERE makes two racing sign-ups converge).
    const { count } = await db().vendorContact.updateMany({ where: { id: existing.id, registeredAt: null }, data: profile });
    if (count === 0) throw taken();
    return { id: existing.id, businessName: profile.businessName, foundingNumber: await claimFoundingSpot(existing.id) };
  }
  try {
    const created = await db().vendorContact.create({ data: { ...profile, phone } });
    return { id: created.id, businessName: created.businessName, foundingNumber: await claimFoundingSpot(created.id) };
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && err.code === "P2002") throw taken();
    throw err;
  }
}

export type VendorProfileUpdate = Omit<VendorRegistration, "phone" | "consent">;

/**
 * A signed-in vendor edits their profile, confirming their password. New details apply to quotes from
 * now on: a vendor Kora has already verified on a purchase is frozen at the database level (I4), so
 * changing the bank account here can't redirect money on an order that is already moving.
 */
/** How long a new payout bank account waits before quotes use it. Changing the password cancels it. */
export const BANK_CHANGE_HOLD_MS = 24 * 60 * 60 * 1000;

/**
 * Changing where money goes is the one change an attacker who takes over a vendor account wants, so
 * it needs two-step sign-in, takes effect only after 24 hours, and the vendor is told straight away.
 * Every other detail changes immediately.
 */
export async function updateVendorProfile(account: Account, input: VendorProfileUpdate, verifyCode: (code: string) => Promise<void>, code: string | undefined): Promise<{ bankChangeEffectiveAt: Date | null }> {
  if (!account.vendorContactId) throw new DomainError("not_vendor", "This account has no vendor profile yet.", 404);
  const contactId = account.vendorContactId;
  await applyDueBankChange(contactId);
  const current = await db().vendorContact.findUniqueOrThrow({ where: { id: contactId } });
  const bankCode = input.bankCode.trim();
  const accountNumber = input.accountNumber.trim();
  const bankChanged = current.bankCode !== bankCode || current.accountNumber !== accountNumber;
  const alreadyPending = current.pendingBankCode === bankCode && current.pendingAccountNumber === accountNumber;
  if (bankChanged && !alreadyPending) {
    if (!account.totpEnabledAt) throw new DomainError("two_step_required", "Turn on two-step sign-in in your account before changing your payout bank account.", 403);
    if (!code) throw new DomainError("code_required", "Enter the code from your authenticator app to change your bank account.", 401, { issues: [{ path: "code", message: "Enter your authenticator code" }] });
    await verifyCode(code);
  }
  const effectiveAt = bankChanged ? (alreadyPending ? current.pendingBankEffectiveAt : new Date(Date.now() + BANK_CHANGE_HOLD_MS)) : null;
  await transaction(async (tx) => {
    await tx.vendorContact.update({
      where: { id: contactId },
      data: {
        businessName: input.businessName.trim(),
        category: input.sells.trim().toLowerCase().replace(/[,;/]+/g, " ").replace(/\s+/g, " "),
        city: input.city.trim(),
        rcNumber: (input.rcNumber ?? "").trim().toUpperCase().replace(/\s+/g, "") || null,
        ownerName: input.ownerName?.trim() || null,
        email: input.email.trim().toLowerCase(),
        ...(bankChanged
          ? { pendingBankCode: bankCode, pendingAccountNumber: accountNumber, pendingBankEffectiveAt: effectiveAt }
          : { pendingBankCode: null, pendingAccountNumber: null, pendingBankEffectiveAt: null }),
      },
    });
    if (bankChanged && !alreadyPending) {
      await notify(tx, {
        accountId: account.id,
        kind: "profile.bank",
        title: "Your payout bank account is changing",
        body: `New quotes will use the account ending ${accountNumber.slice(-4)} from ${effectiveAt?.toISOString().slice(0, 16).replace("T", " ")} UTC. If this wasn't you, change your password now: that cancels the change.`,
        href: "/vendor",
      });
    } else if (!bankChanged) {
      await notify(tx, { accountId: account.id, kind: "profile", title: "Your vendor profile was updated", body: "Your business details were updated.", href: "/vendor" });
    }
  });
  return { bankChangeEffectiveAt: effectiveAt };
}

/** Moves a pending bank change into place once its 24 hours have passed. Safe to call anywhere, any number of times. */
export async function applyDueBankChange(contactId: string): Promise<void> {
  const c = await db().vendorContact.findUnique({ where: { id: contactId }, select: { pendingBankCode: true, pendingAccountNumber: true, pendingBankEffectiveAt: true } });
  if (!c?.pendingBankEffectiveAt || !c.pendingBankCode || !c.pendingAccountNumber || c.pendingBankEffectiveAt > new Date()) return;
  await db().vendorContact.updateMany({
    where: { id: contactId, pendingBankEffectiveAt: c.pendingBankEffectiveAt },
    data: { bankCode: c.pendingBankCode, accountNumber: c.pendingAccountNumber, pendingBankCode: null, pendingAccountNumber: null, pendingBankEffectiveAt: null },
  });
}
