---
updatedAt: 2026-08-05T16:14:00.000Z
agentTools:
  projectIndex: https://developers.korapay.com/llms.txt
---

# Testing your Integration

It is important to test your integration before going live to make sure it works properly. That’s why we created test bank accounts, mobile money numbers and test cards for you to simulate different payment scenarios as you integrate with Kora.

## **Testing Payouts to Bank Accounts**

Use the following bank accounts to test these scenarios for your Bank Transfer payout integration:

| Scenario               | Currency | Bank Code | Account Number |
| :--------------------- | :------- | :-------- | :------------- |
| Successful Payout      | NGN      | `033`     | `0000000000`   |
| Failed Payout          | NGN      | `035`     | `0000000000`   |
| Error: Invalid Account | NGN      | `011`     | `9999999999`   |
| Successful Payout      | KES      | `0068`    | `000000000000` |
| Failed Payout          | KES      | `0053`    | `000000000000` |
| Error: Invalid Account | KES      | `0111`    | `9999999999`   |
| Successful Payout      | ZAR      | `632005`  | `0000000000`   |
| Failed Payout          | ZAR      | `678910`  | `0000000000`   |
| Successful Payout      | EGP      | `NBE`     | `1234567890`   |
| Failed Payout          | EGP      | `CIB`     | `0987654321`   |

## **Testing Payouts to Mobile Money**

Use the following mobile money details to test these scenarios for your Mobile Money payout integration:

| Scenario          | Currency | Mobile Money Operator | Mobile Number   |
| :---------------- | :------- | :-------------------- | :-------------- |
| Successful Payout | KES      | `safaricom-ke`        | `254711111111`  |
| Failed Payout     | KES      | `airtel-ke`           | `254722222222`  |
| Successful Payout | GHS      | `airtel-gh`           | `233242426222`  |
| Failed Payout     | GHS      | `mtn-gh`              | `233722222222`  |
| Successful Payout | TZS      | `tigo-tz`             | `255751111111`  |
| Failed Payout     | TZS      | `airtel-tz`           | `255752222222`  |
| Successful Payout | EGP      | `vodafone-eg`         | `201028894773`  |
| Failed Payout     | EGP      | `orange-eg`           | `200198765432`  |
| Successful Payout | XAF      | `mtn-cm`              | `237671111111`  |
| Failed Payout     | XAF      | `orange-cm`           | `2250522222222` |
| Successful Payout | XOF      | `mtn-ci`              | `2250511111111` |
| Failed Payout     | XOF      | `orange-ci`           | `2250522222222` |

## **Testing Pay-in Mobile Money**

Use the following mobile money numbers to test different scenarios for your Mobile Money pay-in integration:

***

| Scenario           | Mobile Number | Currency | OTP    | PIN  |
| :----------------- | :------------ | :------- | :----- | :--- |
| Successful Payment | 254700000000  | KES      | N/A    | 1234 |
| Failed Payment     | 254734611986  | KES      | N/A    | 1234 |
| Successful Payment | 233240000000  | GHS      | 123456 | 1234 |
| Failed Payment     | 233274611986  | GHS      | 123456 | 1234 |
| Successful Payment | 237655123456  | XAF      | N/A    | 1234 |
| Failed Payment     | 237677123456  | XAF      | N/A    | 1234 |
| Successful Payment | 2250500000000 | XOF      | 123456 | 1234 |
| Failed Payment     | 2250123456789 | XOF      | 123456 | 1234 |
| Successful Payment | 255780000000  | TZS      | 123456 | 1234 |
| Failed Payment     | 255780000002  | TZS      | 123456 | 1234 |
| Successful Payment | 201200000000  | EGP      | N/A    | 1234 |
| Failed Payment     | 201200000002  | EGP      | N/A    | 1234 |

## **Test Cards**

Real payment cards would not work in Test mode. If you need to test your card payment integration, you can use any of the following test cards:

***

**For Successful Payment (No Authentication)** - Visa<br />Card Number: `4084 1278 8317 2787`<br />Expiry Date: `09/30`<br />CVV: `123`

***

**For Successful Payment (with PIN)** - Mastercard<br />Card Number: `5188 5136 1855 2975`<br />Expiry Date: `09/30`<br />CVV: `123`<br />PIN: `1234`

***

**For Successful Payment (with OTP)** - Mastercard<br />Card Number: `5442 0561 0607 2595`<br />Expiry Date: `09/30`<br />CVV: `123`<br />PIN: `1234`<br />OTP: `123456`

***

**For Successful Payment (with 3D Secure)** - Visa<br />Card Number: `4562 5437 5547 4674`<br />Expiry Date: `09/30`<br />CVV: `123`<br />OTP: `1234`

***

**Successful (with Address Verification Service, AVS)**  - Mastercard<br />Card Number: `5384 0639 2893 2071`<br />Expiry Date: `09/30`<br />CVV: `123`<br />PIN: `1234`

For Address<br />City: `Lekki`<br />Address: `Osapa, Lekki`<br />State: `Lagos`<br />Country: `Nigeria`<br />Zip Code: `101010`

***

**Successful (with Card Enroll)** - Verve<br />Card Number: `5061 4604 1012 0223 210`<br />Expiry Date: `09/30`<br />CVV: `123`<br />PIN: `1234`<br />OTP: `123456`

***

**For Failed Payment (Insufficient Funds)** - Verve<br />Card Number: `5060 6650 6066 5060 67`<br />Expiry Date:  `09/30`<br />CVV: `408`

***

To simplify testing your card integrations in Test mode, we already created these scenarios on the test Checkout and prefilled the card details for each scenario.

![](https://files.readme.io/7f97f5d-Screenshot_2021-11-08_at_2.26.39_AM.png "Screenshot 2021-11-08 at 2.26.39 AM.png")

<Callout icon="🚧" theme="warn">
  It is important to note that, just as real payment instruments do not work in Test mode, test cards and bank accounts cannot be used in Live mode or for real payments.
</Callout>

***

## **Testing Identity**

To test identity verification scenarios on the sandbox environment, the test data below should be used:

**For Kenya**

| Document Type          | Scenario      | ID Number     |
| :--------------------- | :------------ | :------------ |
| International Passport | Valid         | `A2011111`    |
| International Passport | Invalid       | `A0000000`    |
| National ID            | Valid         | `25219766`    |
| National ID            | Invalid       | `00000000`    |
| Tax PIN                | Valid         | `A009274635J` |
| Tax PIN                | Invalid       | `A0000000000` |
| Phone Number           | Valid         | `0723818211`  |
| Bank Account           | Valid account | 0123456789    |
| Bank Account           | Bank Code     | 31            |

<br />

**For Ghana**

| Document Type          | Scenario | ID Number       |
| :--------------------- | :------- | :-------------- |
| SSNIT                  | Valid    | `C987464748977` |
| SSNIT                  | Invalid  | `C000000000000` |
| Driver's License       | Valid    | `070667`        |
| Driver's License       | Invalid  | `000000`        |
| International Passport | Valid    | `G0000555`      |
| International Passport | Invalid  | `G0000000`      |
| Voters Card            | Valid    | `9001330422`    |
| Voters Card            | Invalid  | `0000000000`    |

<br />

**For Nigeria**

| Document Type          | Scenario      | ID Number             |
| :--------------------- | :------------ | :-------------------- |
| BVN                    | Valid         | `22222222222`         |
| BVN                    | Invalid       | `00000000000`         |
| vNIN                   | Valid         | `KO111111111111IL`    |
| vNIN                   | Invalid       | `KO000000000000II`    |
| NIN                    | Valid         | `55555555555`         |
| NIN                    | Invalid       | `00000000000`         |
| International Passport | Valid         | `A01234567`           |
| International Passport | Invalid       | `A00000000`           |
| Voters Card (PVC)      | Valid         | `00A0A0A000000000011` |
| Voters Card (PVC)      | Invalid       | `11A1A1A111111111111` |
| Phone Number           | Valid         | `08000000000`         |
| Phone Number           | Invalid       | `08000000001`         |
| CAC (RC Number)        | Valid         | `RC00000011`          |
| CAC (RC Number)        | Invalid       | `RC11111111`          |
| Bank Account (Premium) | Valid account | 0123456789            |
| Bank Account (Premium) | Bank Code     | 000013                |
| Bank Account (Basic)   | Valid account | 0123456789            |
| Bank Account (Basic)   | Bank Code     | 058                   |

<br />

**For South Africa**

| Document Type | Scenario | ID Number       |
| :------------ | :------- | :-------------- |
| SAID          | Valid    | `8012185201077` |
| SAID          | Invalid  | `8000000000001` |

<br />

**For United States**

| Document Type | Scenario | ID Number |
| :------------ | -------- | :-------- |
| SSN           | Valid    | 765439022 |

**For Ivory Coast&#x20;**

| Document Type   | Scenario | ID Number    |
| :-------------- | -------- | :----------- |
| National ID     | Valid    | 00112233440  |
| Old National ID | Valid    | C00112233440 |
| Residence Card  | Valid    | 11223344555  |