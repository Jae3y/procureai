---
updatedAt: 2026-08-15T23:53:38.000Z
agentTools:
  projectIndex: https://developers.korapay.com/llms.txt
---

# Overview

**Pay-ins** (also called Collections) are in-bound payments or fund transfers that you receive into your merchant account. Kora’s Pay-ins service offers a flexible suite of products that enable you to manage payments efficiently, whether through the dashboard or by integrating Kora’s secure APIs.

You can embed a simple Checkout widget to your website/app with minimal technical expertise or create a custom integration using our robust processing engine. The API allows you to securely accept payments from multiple sources, offering your customers flexibility through various payment methods like cards, bank transfers and mobile money.

To receive Pay-ins, you’ll need:

* A verified Kora merchant account (Create your account [here](https://merchant.korapay.com/auth/signup)).
* Configured payment methods such as card payments, mobile money, or bank transfers. Kindly reach out to our [Support Team](mailto:support@korapay.com) for inquiries on this configuration.

<Callout icon="💡" theme="default">
  Currently, Kora supports the receiving payments via:

  - **Card Payments:** Available in Nigeria (NGN).
  - **Mobile Money:** Available in Kenya (KES), Ghana (GHS), Cameroon (XAF), Ivory Coast (XOF), Egypt (EGP), Tanzania (TZS).
  - **Bank Transfers:** Available in Nigeria (NGN).
  - **Pay with Bank:** Available in Nigeria (NGN).
  - **EFTs:** Available in South Africa (ZAR).
  - **Virtual Bank Account:** Available in Nigerian Naira (NGN), Kenya (KES), US Dollar (USD)
  - **Stablecoins:** Available in Tether (USDT) and USD Coin (USDC).
</Callout>

***

## Pay-in Channels

Kora offers multiple ways to securely accept payments. These are known as *Channels*, and is shown in your transaction details. They include:

### [**Checkouts**](https://developers.korapay.com/docs/checkouts)

A simple and secure gateway for customers to complete transactions through a variety of payment methods.

### [**Payment Links**](https://developers.korapay.com/docs/payment-links)

No-code, shareable links that allow customers to pay without needing an API integration.

### [Virtual Bank Accounts](https://developers.korapay.com/docs/virtual-bank-accounts)

Designated virtual bank accounts into which customers can safely transfer funds without hassle.

### [Stablecoins](https://developers.korapay.com/docs/stable-coins)

USDT and USDC wallets for customers to make payments using digital currencies.

### [API](https://developers.korapay.com/docs/checkout-standard)

Programmatically receive payments via Kora’s secure API, supporting cards, mobile money, virtual bank accounts, and EFTs.