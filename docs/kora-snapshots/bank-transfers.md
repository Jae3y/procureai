---
updatedAt: 2025-02-28T00:12:10.000Z
agentTools:
  projectIndex: https://developers.korapay.com/llms.txt
---

# Bank Transfers

Bank transfer payments are one-time payments that your customers can use to pay you through their online banking applications. The Pay with Bank Transfer payment method is available on Kora's Checkout and via API.

# Accepting Bank Transfer Payments via API

One way to accept bank transfer payments is by using our Bank Transfer API. The following guide will show you how to generate single-use bank accounts for your transactions successfully.

***

**Prerequisites:**

1. Before starting, ensure that your Kora account is activated.
2. To accept Bank Transfer payments via API, you need to enable this feature on your account. Contact our team at <support@korapay.com> to request the activation of bank transfer payments via API on your account.

> 💡
>
> Please note that, currently, the Bank Transfer API service is only available for Nigerian Naira (NGN) transactions.

***

To accept bank transfer payments via API, you can make an API call to the [Pay with bank transfer API](https://docs.korapay.com/#442648d8-0e6b-47b5-9e82-0fc73ba0b210) with the required payment information. Once the call is successful, a **dynamic virtual bank account** will be generated for the transaction, which your customer can use to make the payment.

A dynamic virtual bank account is a temporary, single-use bank account that can be used to accept one-time payments for transactions. It is dynamic because it is only valid and usable for a limited period of time and for a single transaction, after which it expires. A new and unique dynamic virtual bank account is created for each new transaction under the Pay with Bank Transfer method.

> 🚧
>
> Presently, the dynamic virtual bank accounts generated for the Bank Transfer payments include Wema Bank, Sterling Bank, and Providus Bank. Additional bank options will be made available over time.

Once you have collected the necessary payment information from your customer, prepare your request to look like the example shown below.

```json Sample Request
{
    "reference": "test-payment-1", 
    "amount": 1500,
    "currency": "NGN",
    "notification_url": "https://merchant-redirect-url.com",
    "customer": {
    	"name": "John Doe",
    	"email": "johndoe@korapay.com"
    }
}
```

The parameters for this request include:

<Table align={["left","left","left","left"]}>
  <thead>
    <tr>
      <th>
        Parameter
      </th>

      <th>
        Type
      </th>

      <th>
        Required
      </th>

      <th>
        Description
      </th>
    </tr>
  </thead>

  <tbody>
    <tr>
      <td>
        `reference`
      </td>

      <td>
        String
      </td>

      <td>
        True
      </td>

      <td>
        A unique reference for the payment. The reference must be at least 8 characters long
      </td>
    </tr>

    <tr>
      <td>
        `amount`
      </td>

      <td>
        Number
      </td>

      <td>
        True
      </td>

      <td>
        The amount for the charge
      </td>
    </tr>

    <tr>
      <td>
        `currency`
      </td>

      <td>
        String
      </td>

      <td>
        True
      </td>

      <td>
        The currency for the charge. Supported currency is `NGN`
      </td>
    </tr>

    <tr>
      <td>
        `notification_url`
      </td>

      <td>
        String
      </td>

      <td>
        False
      </td>

      <td>
        A URL to which we can send the webhook notification for the transaction
      </td>
    </tr>

    <tr>
      <td>
        `customer`
      </td>

      <td>
        Object
      </td>

      <td>
        True
      </td>

      <td>
        The information of your customer you want charge
      </td>
    </tr>

    <tr>
      <td>
        `customer.email`
      </td>

      <td>
        String
      </td>

      <td>
        True
      </td>

      <td>
        The email of your customer
      </td>
    </tr>

    <tr>
      <td>
        `customer.name`
      </td>

      <td>
        String
      </td>

      <td>
        False
      </td>

      <td>
        The name of your customer
      </td>
    </tr>

    <tr>
      <td>
        `account_name`
      </td>

      <td>
        String
      </td>

      <td>
        False
      </td>

      <td>
        The account name that should be displayed when the account number is resolved
      </td>
    </tr>

    <tr>
      <td>
        `merchant_bears_cost`
      </td>

      <td>
        Boolean
      </td>

      <td>
        False
      </td>

      <td>
        This sets who bears the fees of the transaction. If it is set to `true`, the merchant will bear the fee. If it is set to `false`, the customer will bear the fee. By default, it is `false`.
      </td>
    </tr>

    <tr>
      <td>
        `narration`
      </td>

      <td>
        String
      </td>

      <td>
        False
      </td>

      <td>
        Information/narration about the transaction
      </td>
    </tr>

    <tr>
      <td>
        `metadata`
      </td>

      <td>
        Object
      </td>

      <td>
        False
      </td>

      <td>
        This takes a JSON object with a maximum of 5 fields or keys. Empty JSON objects are not allowed.  

        Each field name has a maximum length of 20 characters. Allowed characters: A-Z, a-z, 0-9, and -.
      </td>
    </tr>

    <tr>
      <td>
        `auto_complete`
      </td>

      <td>
        Boolean
      </td>

      <td>
        False
      </td>

      <td>
        * \*Optional\*\* [Only available in the Sandbox environment (test mode)] - Use this to trigger an automatic payment to the test bank account generated in the sandbox environment.
      </td>
    </tr>
  </tbody>
</Table>

Here's what the response to the request would look like:

```json Sample Response
{
 "status": true,
 "message": "Bank transfer initiated successfully",
  "data": {
      "currency": "NGN",
      "amount": 1500,
      "amount_expected": 1500,
      "fee": 22.5,
       "vat": 1.69,
       "reference": "idMain02",
       "payment_reference": "idMain02",
       "status": "processing",
       "narration": "Payment on Demo Merchant",
       "merchant_bears_cost": true,
       "bank_account": {
         "account_name": "Demo account",
         "account_number": "7590031627",
          "bank_name": "wema",
            "bank_code": "035",
            "expiry_date_in_utc": "2023-06-05T16:58:09.193Z"
        },
        "customer": {
            "name": "John Doe",
            "email": "johndoe@gmail.com"
        }
    }
}
```

> 💡
>
> **Note**: `amount expected` is the actual amount that your customer is meant to pay for the transaction, and is dependent on who bears the cost for the transaction.

***

## Getting notified of payments

Once a payment has been made to the generated bank account, we will send a webhook notification to the URL you provided for webhook notifications. The reference included in the notification payload can be used to retrieve the payment details.

You can read more about how to handle webhook notifications [here](https://developers.korapay.com/docs/webhooks).

See an example of a webhook notification below:

```json Sample Webhook Notification
{
  "event": "charge.success",
  "data": {
    "reference": "kpy-test-ref",
    "currency": "NGN",
    "amount": 1500,
    "fee": 22.5,
    "status": "success",
}
```

Before giving value to the customer, it is advisable to requery the transaction by sending a request to the Transaction Query API. To do this, make a GET Request to the [Transaction Query API](https://docs.korapay.com/#acc7c693-5346-4332-98cd-d91fd60f50e6) endpoint using the reference returned in the webhook notification request payload.

***

## Testing the Pay with Bank Transfer API on Sandbox

To test the Pay with bank transfer API on the sandbox environment, all you need to do is to switch your Kora dashboard to test mode and access your test secret key in the API configurations section. Use the test secret key for authorization instead of your live secret key.\
By default, transactions initiated via the bank transfer API on sandbox are completed automatically after 2 minutes. That is, sandbox payments to the bank accounts generated would be automatically triggered without any action from you. However, if you would like to test the payment flow yourself, you can add an additional field called `auto_complete`  to the request payload for the bank transfer API.

```json
{
    "reference": "test-payment-1", 
    "amount": 1000,
    "currency": "NGN",
    "notification_url": "https://merchant-redirect-url.com",
    "customer": {
    	"name": "John Doe",
    	"email": "johndoe@korapay.com"
    },
   “auto_complete”: false // this is the additional field to add
}
```

When the **`auto_complete`** field is set to false, you would be required to trigger a payment to the bank account yourself. You can do this by making use of the Sandbox Credit API for Virtual Bank Accounts. [Sandbox Virtual Bank Account Credit API](https://developers.korapay.com/docs/virtual-bank-accounts#crediting--a-virtual-bank-account-on-the-sandbox-environment).

All you need to do is to pass the account number returned from the bank transfer API and the amount you want to pay.