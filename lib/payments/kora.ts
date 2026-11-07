import { env } from "@/lib/env";
import { kora } from "@/lib/kora/client";
import { KORA_MAX_CHARGE_KOBO, KORA_MAX_PAYOUT_KOBO, KORA_MIN_PAYOUT_KOBO } from "@/lib/kora/limits";
import type { MoneyMovementStatus, PaymentProvider } from "./provider";

/**
 * Kora behind the provider contract. All the Kora specifics (field names, the ₦1m account cap,
 * webhook URL) stay here and in lib/kora. The client is looked up on every call, so tests can
 * point it at the Kora test double.
 */

function movement(status: string): MoneyMovementStatus {
  return status === "success" || status === "failed" ? status : "processing";
}

export const koraProvider: PaymentProvider = {
  id: "kora",
  name: "Kora",
  get isTestMode() {
    return kora().isTestMode;
  },
  get isLiveSandbox() {
    return kora().isLiveSandbox;
  },
  get identitySimulated() {
    return kora().identitySimulated;
  },
  limits: { maxChargeKobo: KORA_MAX_CHARGE_KOBO, minPayoutKobo: KORA_MIN_PAYOUT_KOBO, maxPayoutKobo: KORA_MAX_PAYOUT_KOBO, minRefundKobo: 10_000n },

  async openTransferAccount(i) {
    const r = await kora().createBankTransferCharge({
      reference: i.reference,
      amountKobo: i.amountKobo,
      customer: i.customer,
      accountName: i.accountName,
      narration: i.narration,
      notificationUrl: env().KORA_WEBHOOK_URL,
      metadata: i.metadata,
      autoComplete: false,
    });
    const a = r.data.bank_account;
    return {
      raw: r.raw,
      data: {
        expectedKobo: r.data.amount_expected ?? r.data.amount,
        feeKobo: r.data.fee ?? null,
        accountNumber: a.account_number,
        accountName: a.account_name,
        bankName: a.bank_name,
        expiresAt: a.expiry_date_in_utc ? new Date(a.expiry_date_in_utc) : null,
      },
    };
  },

  async openCheckout(i) {
    const r = await kora().initializeCheckout({
      reference: i.reference,
      amountKobo: i.amountKobo,
      customer: i.customer,
      narration: i.narration,
      notificationUrl: env().KORA_WEBHOOK_URL,
      redirectUrl: i.redirectUrl,
      metadata: i.metadata,
    });
    return { raw: r.raw, data: { checkoutUrl: r.data.checkout_url } };
  },

  async queryCharge(reference) {
    const q = await kora().queryCharge(reference);
    const d = q.data;
    return {
      raw: q.raw,
      data: {
        status: d.status,
        amountKobo: d.amount,
        paidKobo: d.amount_paid ?? null,
        acceptedKobo: d.amount_accepted ?? null,
        feeKobo: d.fee ?? null,
        paymentEvent: d.bank_transfer?.payment_event ?? null,
        message: d.bank_transfer?.message ?? null,
      },
    };
  },

  async sendPayout(i) {
    const r = await kora().disburse({
      reference: i.reference,
      amountKobo: i.amountKobo,
      bankCode: i.bankCode,
      accountNumber: i.accountNumber,
      narration: i.narration,
      customer: i.recipient,
      notificationUrl: env().KORA_WEBHOOK_URL,
      metadata: i.metadata,
    });
    return { raw: r.raw, data: { status: movement(r.data.status), message: r.data.message ?? null, feeKobo: r.data.fee ?? null } };
  },

  async queryPayout(reference) {
    const q = await kora().verifyPayout(reference);
    return { raw: q.raw, data: { status: movement(q.data.status), message: q.data.message ?? null, feeKobo: q.data.fee ?? null } };
  },

  async refund(i) {
    const r = await kora().initiateRefund({ ...i, webhookUrl: env().KORA_WEBHOOK_URL });
    return { raw: r.raw, data: { status: movement(r.data.status) } };
  },

  async queryRefund(reference) {
    const q = await kora().queryRefund(reference);
    return { raw: q.raw, data: { status: movement(q.data.status) } };
  },

  async balance() {
    const b = await kora().getBalances();
    return { availableKobo: b.data.NGN?.available_balance ?? 0n, pendingKobo: b.data.NGN?.pending_balance ?? 0n };
  },

  async banks() {
    const list = await kora().bankPickerList();
    return { banks: list.banks.map((b) => ({ name: b.name, code: b.code })), source: list.source };
  },

  async verifyBusiness(i) {
    const r = await kora().verifyCac(i);
    return { raw: r.raw, data: { reference: r.data.reference, name: r.data.name, companyStatus: r.data.company_status ?? null, keyPersonnel: r.data.key_personnel } };
  },

  async verifyBankAccount(i) {
    const a = await kora().verifyBankAccountBasic(i);
    return { raw: a.raw, data: { reference: a.data.reference, accountName: a.data.account_details.name } };
  },
};
