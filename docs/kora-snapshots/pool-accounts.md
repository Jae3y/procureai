---
updatedAt: 2026-04-07T10:19:14.000Z
agentTools:
  projectIndex: https://developers.korapay.com/llms.txt
---

# Pool Accounts

> 🚧 **Beta Disclaimer**
>
> Please note that **this service is currently only available to merchants participating in our beta program**. If you have any feedback or questions, please [contact us](https://korahq.com/contact-us).

Pool Accounts are a special type of payment solution that enable you to receive local payments efficiently through bank accounts. Instead of generating a unique virtual bank account for every customer, you generate and assign a ***unique Reference ID*** to each customer.

> **💡 Note:** It is important to note that all customer payments are made into a single bank account. However, each payment is uniquely identified and differentiated using the Reference ID provided for that customer or transaction.

Customers make payments directly into a shared pool account using their assigned Reference ID in the payment narration. Because the Reference ID is unique to the customer and required in the payment narration, this process enables automatic tagging and tracing of each transaction back to the correct customer — ensuring clear identification, simplified reconciliation, and accurate settlements to your account.

Whether you're managing hundreds or thousands of customers, Kora’s Pool Account solution simplifies how you track who paid what.

## Benefits of Pool Accounts

With Pool Accounts, you can:

* Get paid locally across supported African countries.
* Assign unique Reference IDs to each customer or transaction for easy tracking.
* Stay updated with real-time notifications when funds are settled to your position.
* Simplify your reconciliation with easy access to downloadable transaction and settlement history.

<br />

## How to accept payments with Pool Accounts

You can start accepting payments from your customers with Pool Accounts in three (3) steps:

1. **Generate a Reference ID**
   To generate a Reference ID, make a request to the *[Create Reference API](https://docs.korapay.com/#b23ded43-1742-4b10-856e-cc90f0984cb8)*. The response will contain the Reference ID and associated account details needed to complete the payment lifecycle.
2. **Set up webhooks**
   Configure your webhook endpoint to receive real-time notifications when payments are made and settled. You can also monitor and filter transaction activity from your dashboard for full visibility.
3. **Verify payment**
   After you receive a webhook notification from us, verify the payment by making a request to our *[Transaction Query API](https://docs.korapay.com/#8a602daa-6e83-4118-9ff3-ba8c09ab6f48)*.

<br />

### Generating a Reference ID

To create a Pool Account Reference ID, you’ll need to make a request to the *[Create Reference API](https://docs.korapay.com/#b23ded43-1742-4b10-856e-cc90f0984cb8)* endpoint.

`https://api.korapay.com/merchant/api/v1/pool-accounts`

You can generate a reference ID for any of the countries listed below. To generate a reference for a specific country, the currency code (as shown below) must be passed in the currency field as seen below.

<Table align={["left","left","left"]}>
  <thead>
    <tr>
      <th>
        Currency Code
      </th>

      <th>
        Country
      </th>

      <th>
        Available Payment Methods
      </th>
    </tr>
  </thead>

  <tbody>
    <tr>
      <td>
        GHS
      </td>

      <td>
        🇬🇭 Ghana
      </td>

      <td>
        * GIP Instant Transfer (_Preferred_)
        * ACH Next Day Payment - Settled by 10:00AM the following day
        * Mobile Money
      </td>
    </tr>

    <tr>
      <td>
        KES
      </td>

      <td>
        🇰🇪 Kenya
      </td>

      <td>
        * Instant Transfer
      </td>
    </tr>

    <tr>
      <td>
        XAF
      </td>

      <td>
        🇨🇲 Cameroon
      </td>

      <td>
        * Instant Transfer
      </td>
    </tr>

    <tr>
      <td>
        XOF
      </td>

      <td>
        🇨🇮 Côte d’Ivoire (Ivory Coast)
      </td>

      <td>
        * Instant Transfer
      </td>
    </tr>

    <tr>
      <td>
        ZAR
      </td>

      <td>
        🇿🇦 South Africa
      </td>

      <td>
        * Instant Transfer
      </td>
    </tr>
  </tbody>
</Table>

<br />

Here are the request parameters for the endpoint:

| Parameter        | Type   | Required | Description                                                                                                    |
| :--------------- | :----- | :------- | :------------------------------------------------------------------------------------------------------------- |
| `customer_name`  | String | True     | The full name of the customer.                                                                                 |
| `customer_email` | String | True     | The email address of the customer.                                                                             |
| `currency`       | String | True     | The currency code for the transaction                                                                          |
| `account_type`   | String | False    | Type of account for Pool Account(bank\_account or mobile\_money), defaults to bank\_account when not provided. |

<br />

Here's an example of a request:

```json Sample Request
{
    "customer_name": "John Doe",
    "customer_email": "johndoe@gmail.com",
    "currency": "KES",
    "account_type": "bank_account"
}
```

<br />

Here's what a response could look like:

```json Sample Response
{
  "status": true,
  "message": "Pool account reference has been created successfully",
  "data": {
      "reference": "DEMKP12345689KES",
      "customer_name": "test1",
      "customer_email": "tes29@gmail.com",
      "currency": "KES",
      "date_created": "2025-08-05T10:08:39.967Z",
      "account_details": {
          "currency": "KES",
          "bank_code": "1234567890",
          "bank_name": "Kora KES Bank",
          "swift_code": "KORABANK123",
          "account_name": "Kora Technologies Ltd",
          "account_number": "1234567890",
          "branch_address": "123 Kora Street, City, Country"
        }
    }
}
```

💡 The Reference ID will usually have the following format below:
`{MerchantPrefix} + KP + {RandomAlphaNumeric} + {Currency}`

<br />

You can also generate a Reference ID directly from the Merchant Dashboard. To do that, simply follow these steps:

1. Log in to your Merchant Dashboard.
2. Navigate to the Accounts tab on the side menu.
3. Click on the Account dropdown on the page and select 'Pool Accounts'.
4. On the Pool Accounts page, click on "Generate Reference".

<br />

<Image align="center" alt="Pool Accounts" src="https://files.readme.io/325d1f9943fae3109fefad41bf050c2f07cfa8da74650c0429165dc7f4ecd42f-Screenshot_2025-08-07_at_11.21.58_PM.png" />

<br />

5. Enter the required customer details.
6. A new Reference ID will be generated instantly and displayed on your dashboard.

<br />

<Image align="center" alt="Generate Pool Account" src="https://files.readme.io/8016ffe08aa7c7692793a266d219634c340a8317cc81ed73fb9df001627330c6-Screenshot_2025-08-07_at_11.23.36_PM.png" />

<br />

### Share the Reference ID with Your Customer

Once a Reference ID has been generated, you must share it with the customer along with the corresponding bank account details provided to you. The customer is required to include the exact Reference ID in the payment narration or description field to ensure accurate tracking and successful reconciliation.

<Callout icon="💡" theme="default">
  Only one Reference ID can be generated per customer email address.
</Callout>

If you attempt to generate another Reference ID with an email address that has already been assigned to an existing Reference ID, you'll receive the following error response payload:

```json Error Response
{
    "status": false,
    "message": "A reference already exists for this customer",
    "data": {
        "reference": "DEMKP12345689KES",
        "customer_name": "John Dore",
        "customer_email": "johndoe@gmail.com",
        "currency": "KES",
        "date_created": "2025-08-05T10:08:39.000Z",
        "account_details": {
            "currency": "KES",
            "bank_code": "1234567890",
            "bank_name": "Kora KES Bank",
            "swift_code": "KORABANK123",
            "account_name": "Kora Technologies Ltd",
            "account_number": "1234567890",
            "branch_address": "123 Kora Street, City, Country"
        }
    }
}
```

<Image align="center" alt="Generation Error" src="https://files.readme.io/ea7d2e21eb0c69d465ab6cfd1a494b6792105d3057517da9ba304d8a82e4f912-Screenshot_2025-08-07_at_11.28.59_PM.png" />

***

## Getting notified of the payment

After payment has been made into a Pool Account with the associated Reference ID, we send a webhook notification to your webhook notification URL. The reference in the notification payload can be used to get the details of the payment.

You can read more about how to handle webhook notifications [here](https://developers.korapay.com/docs/webhooks).

Here's a sample webhook notification:

```json Webhook Notification
{
  "event": "charge.success",
  "data": {
    "fee": 0,
    "amount": 200,
    "status": "success",
    "currency": "KES",
    "reference": "KPY-PAY-47AgdDKFMklhVSg",
    "payment_method": "pool_account",
    "payment_reference": "KPY-PAY-47AgdDKFMklhVSg",
    "pool_account": {
      "payer_details":{
          "payer_name":"Test Payer",
          "payer_account_number":"0000000000"
    },
	  "pool_account_reference": "DEMKP12345689KES",
	  "account_details": {
            "currency": "KES",
            "bank_code": "1234567890",
            "bank_name": "Kora KES Bank",
            "swift_code": "KORABANK123",
            "account_name": "Kora Technologies Ltd",
            "account_number": "1234567890",
            "branch_address": "123 Kora Street, City, Country"
          }
    },
    "transaction_date": "2025-09-12T09:11:09.338Z"
}

```

<br />

## Getting the details of the payment made to the Pool Account

All the payments that have been made to a Pool Account can be retrieved by making a GET request to the [Transaction Query API](https://docs.korapay.com/#8a602daa-6e83-4118-9ff3-ba8c09ab6f48) endpoint.

`https://api.korapay.com/merchant/api/v1/charges/:reference`

The request parameters for this endpoint are:

| Parameter   | Type   | Required | Description                                                    |
| :---------- | :----- | :------- | :------------------------------------------------------------- |
| `reference` | String | True     | This is the payment reference sent in the webhook notification |

And, the response to the request could look like this:

```json Sample Response
{
   "status": true,
   "message": "Charge retrieved successfully",
   "data": {
       "reference": "KPY-PAY-47AgdDKFMklhVSg",
       "status": "success",
       "amount": "200.00",
       "amount_paid": "200.00",
       "fee": 0,
       "currency": "GHS",
       "description": "Pool account transfer from John Doe",
       "customer": {
           "name": "John Doe",
           "email": "johndoe@gmail.com"
       },
       "pool_account": {
         "pool_account_reference": "DEMKP12345689GHS",
				 "account_details": {
               "currency": "GHS",
               "bank_code": "123456",
               "bank_name": "Kora GHS Bank",
               "swift_code": "KORABANK123",
               "account_name": "Kora",
               "bank_address": "123 Kora Street",
               "account_number": "1234567890"
           },
         "payer_details": {
            "payer_name": "Test Payer",
            "payer_account_number":"0000000000"
           }

       }
   }
}
```

***

## Error Codes

The following error codes may be returned by the API:

| Status  | HTTP Code | Message                                                           | Possible Cause                                        | Suggested Action                                        |
| :------ | :-------- | :---------------------------------------------------------------- | :---------------------------------------------------- | :------------------------------------------------------ |
| `false` | 409       | A reference already exists for this customer.                     | Email has already been used to create a Reference ID. | Retry with a new email to get a different Reference ID. |
| `false` | 503       | Internal server error. It would be nice if you report this to us. | Unexpected error on the internal server.              | Contact support if the issue persists.                  |
| `false` | 403       | You are not authorized to use this service.                       | The product has not been enabled for the business.    | Contact support to assist.                              |

<br />

## API Statuses and Description Reference

<Table align={["left","left"]}>
  <thead>
    <tr>
      <th>
        Status
      </th>

      <th>
        Description / Message
      </th>
    </tr>
  </thead>

  <tbody>
    <tr>
      <td>
        `success`
      </td>

      <td>
        This is used in webhook notifications when a payment is successfully completed. Example message: `"event": "charge.success"` and `"status": "success"`.
      </td>
    </tr>

    <tr>
      <td>
        `success`
      </td>

      <td>
        This is used in the Transaction Query API response when a charge is successfully retrieved: `"message": "Charge retrieved successfully"`.
      </td>
    </tr>

    <tr>
      <td>
        `true`
      </td>

      <td>
        Returned in API responses to indicate the operation was successful.

        Sample messages: `"Pool account reference has been created successfully"` (when creating a pool account reference) and `"Charge retrieved successfully"` (when retrieving a charge).
      </td>
    </tr>

    <tr>
      <td>
        `false`
      </td>

      <td>
        Returned in API responses to indicate the operation was not successful.

        Message: `"A reference already exists for this customer"` (when trying to generate a Reference ID for an email that already has one).
      </td>
    </tr>
  </tbody>
</Table>

***

## Support

Need help with using Pool Accounts? Reach out to <support@korapay.com>
(*Please include the Pool Account Reference ID and transaction details in your request for faster resolution.*)