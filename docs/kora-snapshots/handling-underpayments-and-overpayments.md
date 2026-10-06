---
updatedAt: 2025-02-28T00:12:10.000Z
agentTools:
  projectIndex: https://developers.korapay.com/llms.txt
---

# Handling Underpayments and Overpayments for Bank Transfer Payments

When a dynamic virtual bank account is generated for bank transfer payments, it is expected that a certain amount is to be paid into the bank account. This amount is known as the `amount expected`

Here's a breakdown of the different amounts that apply to a bank transfer transaction:

* Amount (`amount`)
* Amount Expected
* Amount Paid (`amount_paid`)
* Amount Accepted (`amount_accepted`)

1. **Amount** is the amount you passed to Kora in your request payload.
2. **Amount Expected** is the amount your customer is expected to pay. This will vary based on who is bearing the cost of the transaction. If you are bearing the cost, the amount expected would be the same as the amount you passed in the request payload. If you are passing the cost to your customer, the amount expected would include fees (*amount plus fee*).
3. **Amount Paid** is the exact amount your customer paid into the bank account generated for the transaction.
4. **Amount Accepted** is the amount that was processed by Kora. This would vary based on your configuration for overpayments and underpayments. If you are accepting overpayments or underpayments, the accepted amount would be the exact amount your customer paid. If you are not accepting overpayments or underpayments, this would be the amount you passed to us in your request payload. ***You are expected to use this field to give value to your customer***.

> 🚧
>
> You are expected to use the `amount_accepted`field to credit value to your customer.

An **Overpayment** occurs when the *Amount Paid* **is greater than** the *Amount Expected*. Similarly, an **Underpayment** occurs when the *Amount Paid* **is less than** the *Amount Expected*.

***

## Preferences for Handling Overpayments and Underpayments

There are different ways merchants may prefer to handle overpayments and underpayments made by their customers. A merchant may choose any one of the following options from their dashboard:

***

<Image align="center" src="https://files.readme.io/bff2bc5-Screenshot_2023-09-15_at_12.52.35_PM.png" />

***

1. **Return Excess**: *This only applies to overpayments and is the default preference.*\
   With your preference to “Return excess”, when a customer makes an overpayment, the excess amount is deducted and reversed to the customer. For example, if the `amount_expected` for a transaction is NGN 1,000.00, and a customer pays NGN 1,500.00 (`amount_paid`). We would return NGN 500.00 to the customer and process NGN 1,000.00 (`amount_accepted`) per the usual flow.
2. **Return All**: *This applies to both overpayments and underpayments. This is also the default preference for underpayments.*\
   In the case where a customer makes an overpayment or underpayment, if your preference is set to “Return all”, the entire amount is reversed to the customer. This action does not affect the status of the transaction; the status of the transaction would remain PROCESSING, until the correct amount is paid or the transaction expires.
3. **Accept All**: *This applies to both overpayments and underpayments.*\
   When this is set, if a customer makes an overpayment or underpayment, the transaction will be processed with whatever amount the customer pays. However, for this setting, the merchant will always bear the cost of the transaction. That is, the amount that would be settled into the Kora balance will always be *Amount Accepted minus fees*.

***

When payments are made to bank accounts generated via **Pay with Bank Transfer** and the payment is processed successfully, a webhook notification is sent to the webhook URL set on your dashboard with a payload that looks like this:

```json Webhook Notification
{
  "event": "charge.success",
  "data": {
    "reference": "test",
    "payment_reference": "005",
    "currency": "NGN",
    "amount": 1000,
    "fee": 53,
    "payment_method": "bank_transfer",
    "status": "success"
  }
}
```

> 🚧
>
> **Please note**: The `amount` in the webhook notification payload above will always be the amount you passed to Kora in your request payload.

To get the actual amount your customer paid and the actual amount you should credit to your customer, make a GET request to the [Transaction Query API endpoint](https://docs.korapay.com/#acc7c693-5346-4332-98cd-d91fd60f50e6) using the reference returned in the webhook notification request payload.

***

> ❗️ IMPORTANT
>
> In order to utilize the feature to set preferences for handling overpayments and underpayments, you are **required** to integrate the [Transaction Query API endpoint](https://docs.korapay.com/#acc7c693-5346-4332-98cd-d91fd60f50e6) to always confirm the amount paid by your customer and also the value to give to your customer using the `amount_accepted`.

***

If the transaction has an overpayment or underpayment, this is what the response from the Query API would look like:

```json Response
{
  "status": true,
  "message": "Charge retrieved successfully",
  "data": {
    "reference": "test",
    "status": "success",
    "amount": 1000,
    "amount_paid": 2500,
    "amount_accepted": 2500,
    "currency": "NGN",
    "fee": 53,
    "description": "",
    "customer": {},
    "bank_transfer": {
      "payer_bank_account": {
        "account_name": "SANDBOX ACCOUNT",
        "account_number": "0000000000",
        "bank_name": "KORA SANDBOX"
       },
      "payment_event": "overpayment",
      "message": "overpayment occured, reversal initiated",
      "reversal": {
        "status": "success",
        "amount": "1473.12",
        "destination": "Payer Bank Account",
        "currency": "NGN"
      }
    } 
 }
}
```

*N-B The`amount_paid` field is the actual amount your customer paid to us, while the `amount` field is the amount you passed as the transaction amount. The `amount_accepted` field is the amount that was processed. You are expected to use the `amount_accepted` to credit value your customer.*

The `bank_transfer.reversal` field will only have valid values for *Return Excess* and *Return All* scenarios. This field signifies that there was a reversal for the transaction.

```Text Response
"bank_transfer": {
  "payer_bank_account": {
    "account_name": "SANDBOX ACCOUNT",
    "account_number": "0000000000",
    "bank_name": "KORA SANDBOX"
  },
  "payment_event": "overpayment",
  "message": "overpayment occured, reversal not initiated",
  "reversal": null
}
```

In the response above, the `payment_event` is still overpayment, but the reversal is `null`. Also, the message `reversal not initiated` means that, for this transaction, the entire overpayment was processed and so there was no reversal. This would only happen when the payment preference for overpayments or underpayments is set to *Accept*.

The `bank_transfer.payment_event` field will only be present if there is an overpayment or underpayment on the transaction.

Both sample responses above return a status of `success`. However, this is because the transaction was processed as a result of the payment preference set to *Return Excess* or *Accept*.

Note that the payment event *Return All* does not have any effect on the transaction at all. It simply implies that an overpayment/underpayment would not be processed.