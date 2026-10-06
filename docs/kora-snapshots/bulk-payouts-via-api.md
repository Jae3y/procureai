---
updatedAt: 2025-02-28T00:12:25.000Z
agentTools:
  projectIndex: https://developers.korapay.com/llms.txt
---

# Bulk Payouts via API

Similar to making a single payout to a bank account via API, you can also use our API to make payouts to multiple bank accounts.

When you initiate a bulk payout request, the disbursement is made from your balance. We send a webhook notification after each individual payout in the batch is completed. In addition, we send an email notification when the bulk payout is initiated, and another when it is complete.

> 📘
>
> Currently, Kora’s Bulk Payout API supports Payouts to:
>
> * Nigerian (NGN) bank accounts
> * Kenyan (KES) Mobile money accounts
> * South African (ZAR) bank accounts
> * Ghanaian (GHS) Mobile Money accounts

> ☝️
>
> Before initiating a bulk payout, always ensure that there are sufficient funds in your balance to cover it.

Similar to a payout to a single bank account, you can also retrieve the status of each payout in a batch using our verify API or through the dashboard.

***

The endpoint to call when **initiating a bulk payout** is:

`{{baseurl}}/api/v1/transactions/disburse/bulk`

The request body should include:

<Table align={["left","left","left"]}>
  <thead>
    <tr>
      <th>
        Field
      </th>

      <th>
        Data Type
      </th>

      <th>
        Description
      </th>
    </tr>
  </thead>

  <tbody>
    <tr>
      <td>
        batch\_reference
      </td>

      <td>
        String
      </td>

      <td>
        * \*Required\*\* - A unique reference for the bulk payout. This reference should have a length between 5 and 50 characters.
      </td>
    </tr>

    <tr>
      <td>
        description
      </td>

      <td>
        String
      </td>

      <td>
        **Optional**
      </td>
    </tr>

    <tr>
      <td>
        merchant\_bears\_cost
      </td>

      <td>
        Boolean
      </td>

      <td>
        * \*Optional\*\* - This will set who bears the fees of the transactions. If it is set to `true`, the merchant will bear the fee, while if it is set to `false`, the customer will bear the fee. By default, it is `false`.
      </td>
    </tr>

    <tr>
      <td>
        currency
      </td>

      <td>
        String
      </td>

      <td>
        * \*Required\*\* - This is the currency of the transactions. E.g. `NGN`, `KES`, `GHS`, `ZAR`.
      </td>
    </tr>

    <tr>
      <td>
        payouts
      </td>

      <td>
        Array [Object]
      </td>

      <td>
        * \*Required\*\* - This captures all the payouts in the batch. A minimum of 2 and a maximum of 50 payouts are allowed in a batch.
      </td>
    </tr>

    <tr>
      <td>
        payout
      </td>

      <td>
        Object
      </td>

      <td>
        * \*Required\*\* - This will capture how each object in the array of payouts will look like.
      </td>
    </tr>

    <tr>
      <td>
        payout.reference
      </td>

      <td>
        String
      </td>

      <td>
        * \*Required\*\* - A unique reference passed for the individual payout. This reference should have a length between 5 and 50 characters.
      </td>
    </tr>

    <tr>
      <td>
        payout.amount
      </td>

      <td>
        Number
      </td>

      <td>
        * \*Required\*\* - This is the transaction amount in two decimal places.
      </td>
    </tr>

    <tr>
      <td>
        payout.type
      </td>

      <td>
        String
      </td>

      <td>
        * \*Required\*\* - This value accepted is `bank_account`.
      </td>
    </tr>

    <tr>
      <td>
        payout.narration
      </td>

      <td>
        String
      </td>

      <td>
        * \*Required\*\* - This is the transaction's narration.
      </td>
    </tr>

    <tr>
      <td>
        payout.bank\_account
      </td>

      <td>
        Object
      </td>

      <td>
        * \*Required\*\* - This captures the details of the receiving bank account for the payout
      </td>
    </tr>

    <tr>
      <td>
        payout.bank\_account.bank\_code
      </td>

      <td>
        String
      </td>

      <td>
        * \*Required\*\* - This is the recipient's bank code. Some bank codes that you can use to simulate successful transactions in *test mode* are `044`, `033`, `058` (i.e. for  Access Bank, UBA and GTCO respectively).  

        See the bank details for other test scenarios [here](https://developers.korapay.com/docs/testing-your-integration).
      </td>
    </tr>

    <tr>
      <td>
        payout.bank\_account.account\_number
      </td>

      <td>
        String
      </td>

      <td>
        * \*Required\*\* - This is recipient's account number.
      </td>
    </tr>

    <tr>
      <td>
        payout.customer
      </td>

      <td>
        Object
      </td>

      <td>
        * \*Required\*\* - This captures the details of the customer.
      </td>
    </tr>

    <tr>
      <td>
        payout.customer.name
      </td>

      <td>
        String
      </td>

      <td>
        * \*Required\*\* - This is the name of the customer.
      </td>
    </tr>

    <tr>
      <td>
        payout.customer.email
      </td>

      <td>
        String
      </td>

      <td>
        * \*Required\*\* - This is the email of the customer.
      </td>
    </tr>
  </tbody>
</Table>

Here’s how the response for your payout request should look like:

```json Bulk Payout Response
{
    "status": true,
    "message": "Bulk Transfer initiated successfully",
    "data": {
       "status": "pending",
       "total_chargeable_amount": 1000,
       "merchant_bears_cost": false,
       "reference": "Batch-Reference-01",
       "currency": "NGN",
       "description": "test bulk transfer",
       "createdAt": "2023-04-10TI7:38:42.521Z",
    }
}
```

## Fetch Bulk Payout

You can fetch an initiated bulk payout with the following endpoint. It also returns the status of the bulk payout which could be `pending`, `failed`, or `complete` .

`{{baseurl}}/api/v1/transactions/bulk/:batch_reference`

The response to this could look like:

```json Sample Response
{
    "status": true,
    "message": "Bulk transaction retrieved successfully",
    "data": {
        "amount": "3500.00",
        "currency": "NGN",
        "reference": "batch_reference",
        "status": "complete",
        "description": "test bulk transfer",
        "failedTransactions": 1,
        "successfulTransactions": 1,
        "pendingTransactions": 0,
        "processingTransactions": 0
    }
}
```

***

## Fetch all Payouts in the Batch

You can also fetch all the payouts in a batch with the following endpoint. It returns an array of payouts.

`{{baseurl}}/api/v1/transactions/bulk/:batch_reference/payouts`

An example of a response could look like this:

```json Sample Response
{
    "status": true,
    "message": "Payouts retrieved successfully",
    "data": {
        "data": [
            {
                "reference": "001_Reference",
                "amount": 1000,
                "currency": "NGN",
                "narration": "Test transfer to F4B Developers",
                "status": "success",
                "batch_reference": "Test_Bulk_reference",
                "type": "bank_account",
                "customer": {
                    "name": "Test User 1",
                    "email": "test1@test.com"
                },
                "bank_account": {
                    "bank_code": "044",
                    "account_number": "0000000000"
                }
            },
            {
                "reference": "002_Reference",
                "amount": 1200,
                "currency": "NGN",
                "narration": "Test transfer to F4B Developers",
                "status": "success",
                "batch_reference": "Test_Bulk_reference",
                "type": "bank_account",
                "customer": {
                    "name": "Test User 2",
                    "email": "test2@test.com"
                },
                "bank_account": {
                    "bank_code": "044",
                    "account_number": "0000000000"
                }
            },
            {
                "reference": "003_Reference",
                "amount": 1300,
                "currency": "NGN",
                "narration": "Test transfer to F4B Developers",
                "status": "success",
                "batch_reference": "Test_Bulk_reference_S",
                "type": "bank_account",
                "customer": {
                    "name": "Test User 3",
                    "email": "test3@test.com"
                },
                "bank_account": {
                    "bank_code": "044",
                    "account_number": "0000000000"
                }
            },
        ],
        "paging": {
            "total_items": 3,
            "page_size": 10,
            "current": 1,
            "count": 3
        },
      }
}
```

***

## Fetch Payout Transaction

You can fetch a single payout in a batch by their reference with the following endpoint.

`{{baseurl}}/api/v1/transactions/:reference`

**If the payout was successful**, you would get a response that could look like this:

```json Sample Response for Successful Payout
{
    "status": true,
    "message": "Transaction retrieved successfully",
    "data": {
        "reference": "001_payout_reference",
        "batch_reference": "batch_reference",
        "status": "success",
        "amount": 1000,
        "fee": 15.31,
        "currency": "NGN",
        "narration": "Test transfer to Test User",
        "trace_id": "521853970021533363527535291465",
        "message": "Payout successful",
        "customer": {
            "email": "testuser@test.com",
            "name": "Test User"
        },
        "metadata": null
    }
}
```

And **if the payout failed**, you would get a response that could look like this:

```json Sample Response for Failed Payout
{
    "status": true,
    "message": "Transaction retrieved successfully",
    "data": {
        "reference": "001_payout_reference",
        "batch_reference": "batch_reference",
        "status": "failed",
        "amount": 1000.00,
        "fee": 15.31,
        "currency": "NGN",
        "narration": "Test transfer to Test user",
        "message": "Invalid Bank Account",
        "customer": {
            "email": "testuser@test.com",
            "name": "Test User"
        },
        "metadata": null
    }
}
```