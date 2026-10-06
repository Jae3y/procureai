---
updatedAt: 2026-08-15T23:50:01.000Z
agentTools:
  projectIndex: https://developers.korapay.com/llms.txt
---

# Overview

Payouts, also sometimes called Disbursements, are outbound fund transfers from your merchant account to any bank account.

You can easily create and manage your payouts directly from your dashboard or through Kora’s Payout API. The API enables you to send payments via a simple, secure process that requires only the bank information of the recipients.

**To make a payout, all you need is**

1. Of course, your Kora account (Create an account [here](https://merchant.korapay.com/)), and
2. To ensure that your available balance is sufficiently funded. See how to do that [here](https://developers.korapay.com/docs/get-balance#funding-your-balance).
3. The recipient's details.

<Callout icon="📘" theme="info">
  Currently, Kora’s Payout API supports Payouts to:

  - Nigerian (NGN) bank accounts
  - Kenyan (KES) bank accounts
  - South African (ZAR) bank accounts
  - Kenyan (KES) mobile money accounts
  - Ghanaian (GHS) mobile money accounts
  - Ivorian (XOF) Mobile Money accounts
  - Cameroonian (XAF) Mobile Money accounts
  - Egyptian (EGP) Mobile Money accounts
  - US Dollar (USD) bank accounts
  - British Pound (GBP) bank account
  - Tanzanian Shilling (TZS) Mobile money accounts
  - Stablecoins (USDC and USDT)
</Callout>

Payouts on Kora are secure, and many merchants also prefer them for the following reasons:

* Detailed records — Your complete payout history is always readily available, and you receive notifications when your payments are updated. You can also download your transaction history for your accounting purposes.

* Reduced risk — Kora’s risk and compliance controls help protect you against fraud.

* Flexible integration — Integrating the Payout API is super simple and straightforward.

***

# **Methods of Payouts**

There are two ways you can make payouts from your account. These are also called 'Channel' in the transaction details on your dashboard.

### [Payout API](https://developers.korapay.com/docs/payout-via-api)

Make single or multiple payouts programmatically from within your application.

### [Withdrawals](https://developers.korapay.com/docs/withdrawals)

Make single withdrawals to your accounts. No integration is needed.

### [Bulk Payouts via API](https://developers.korapay.com/docs/bulk-payouts-via-api)

Transfer money to multiple customer accounts at once. Saves time! Great for payroll, and vendor payments.