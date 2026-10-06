---
updatedAt: 2026-07-30T18:42:27.000Z
agentTools:
  projectIndex: https://developers.korapay.com/llms.txt
---

# Accepting payments with NGN Virtual Bank Accounts

There are three main steps to note when it comes to accepting NGN payments from your customers with Virtual Bank Accounts:

**1. Create Virtual Accounts for customers**
To create Virtual Bank Accounts for your customers make a request to the [Create Virtual Bank Account API](https://docs.korapay.com/#758aa9ef-c9cd-41b0-86d7-b71f53990f74). These accounts can be used to accept payments immediately after they are created. To retrieve details of a virtual account, make a request to the [Virtual Bank Account Query API](https://docs.korapay.com/#972e66eb-d625-4510-ad60-67e9709b7d04).

<Callout icon="🚧" theme="warn">
  By default, you can only create a total of fifty (50) virtual bank accounts. If you would need to upgrade this limit, please send a request to [support@korapay.com](mailto:support@korapay.com).
</Callout>

**2. Set up webhooks**
Since payments to virtual accounts are initiated outside your application, you can only be notified when the payment is complete. This makes it important to set up webhooks so that Korapay can notify you when your customers make payments.

**3. Verify payments**
After you receive a webhook notification from us, verify the payment by making a request to our [Transaction Query API](https://docs.korapay.com/#acc7c693-5346-4332-98cd-d91fd60f50e6).

# **Creating an NGN Virtual Bank Account**

To create an NGN Virtual Bank Account, you’ll need to make a request to the [Create Virtual Bank Account API](https://docs.korapay.com/#758aa9ef-c9cd-41b0-86d7-b71f53990f74) endpoint.

<Callout icon="ℹ️" theme="info">
  As at January 2026, you can generate a live Virtual Bank Account from any of the local NGN banks listed below. To use a specific bank, the bank code (as shown below) should be passed in the `bank_code` field.

  | Bank          | Bank Code |
  | :------------ | :-------- |
  | Wema          | `035`     |
  | Fidelity Bank | `070`     |
  | Globus Bank   | `103`     |
  | UBA           | `033`     |
  | Moniepoint    | `090405`  |
  | Optimus Bank  | `107`     |
  | Parallex Bank | `104`     |
  | FCMB          | `214`     |
</Callout>

<br />

**Endpoint** - `https://api.korapay.com/merchant/api/v1/virtual-bank-account`

Here are the request parameters for the endpoint:

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
        Required?
      </th>

      <th>
        Description
      </th>
    </tr>
  </thead>

  <tbody>
    <tr>
      <td>
        `account_name`
      </td>

      <td>
        String
      </td>

      <td>
        True
      </td>

      <td>
        The name of the Virtual Bank account.
      </td>
    </tr>

    <tr>
      <td>
        `account_reference`
      </td>

      <td>
        String
      </td>

      <td>
        True
      </td>

      <td>
        Your unique reference to identify a virtual bank account.
      </td>
    </tr>

    <tr>
      <td>
        `permanent`
      </td>

      <td>
        Boolean
      </td>

      <td>
        True
      </td>

      <td>
        This shows if the account is permanent or temporary. This can only be set to `true` for now.
      </td>
    </tr>

    <tr>
      <td>
        `bank_code`
      </td>

      <td>
        String
      </td>

      <td>
        True
      </td>

      <td>
        This is the bank code of the bank providing the virtual bank account. `070` is the code for Fidelity Bank.

        Use `000` to create a virtual bank account in the sandbox environment.
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
        This is the information of your customer to which you assign the virtual bank account.
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
        False
      </td>

      <td>
        The customer's email.
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
        True
      </td>

      <td>
        The customer's name.
      </td>
    </tr>

    <tr>
      <td>
        `kyc`
      </td>

      <td>
        Object
      </td>

      <td>
        True
      </td>

      <td>
        This houses the KYC information of the customer. **_This is a mandatory requirement starting from the 26th of January, 2024_**.
      </td>
    </tr>

    <tr>
      <td>
        `kyc.nin`
      </td>

      <td>
        String
      </td>

      <td>
        False
      </td>

      <td>
        The National Identity Number (NIN) of your customer.
      </td>
    </tr>

    <tr>
      <td>
        `kyc.bvn`
      </td>

      <td>
        String
      </td>

      <td>
        True
      </td>

      <td>
        The Bank Verification Number (BVN) of the customer.
      </td>
    </tr>
  </tbody>
</Table>

Here's what a response would look like:

```json Code: Response
{
  "status": true,
  "message": "Virtual bank account created successfully",
  "data" {
    "account_name": "Afro Jon",
    "account_number": "0657789765",
    "bank_code": "070",
    "bank_name": "Fidelity Bank",
    "account_reference": "{{your_account_reference}}",
    "unique_id": "{{ korapay_account_reference}}",
    "account_status": "active",
    "created_at": "2021-08-10TI7:38:42.521Z",
    "currency": "NGN",
    "customer": {
       "name": "Test Customer"
    }
  }
}
```

![](https://files.readme.io/c538bed-Merchant_Virtual_Accounts.png "Merchant Virtual Accounts.png")

***

# **Retrieving the details of an NGN Virtual Bank Account**

The details of an NGN Virtual Bank Account can be retrieved at any time after creating the account. To do this, you’ll need to initiate a GET request to the [Virtual Bank Account Query API](https://docs.korapay.com/#972e66eb-d625-4510-ad60-67e9709b7d04) endpoint.

**Endpoint** - `https://api.korapay.com/merchant/api/v1/virtual-bank-account/:accountReference`

Here's what the response of a successful request would look like:

```json Code: Response
{
  "status": true,
  "message": "Virtual bank account retrieved successfully",
  "data": {
    "account_name": "Afro Jon",
    "account_number": "0657789765",
    "bank_code": "070",
    "bank_name": "Fidelity Bank",
    "account_reference": "{{your_account_reference}}",
    "unique_id": "{{ korapay_account_reference }}",
    "account_status": "active",
    "created_at": "2021-08-10TI7:38:42.521Z",
    "currency": "NGN",
    "customer": {
       "name": "Test Customer"
    }
  }
}
```

The details of a Virtual Bank Account can also be viewed on your Merchant dashboard. Simply click on an account on the list of Virtual Bank Accounts to view its details.

On the details page, you would see an account summary showing the account name, account number, details of the customer to which the virtual account has been assigned, as well as other important information on the account. You would also see a list of all the transactions made through the virtual account in the Transaction History section.

# **Getting notified of payments**

After payment has been made into a VBA, we send a webhook notification to your webhook notification URL. The reference in the notification payload will be used to get the details of the payment.

You can read more about how to handle webhook notifications [here](https://developers.korapay.com/docs/webhooks).

Here's a sample webhook notification:

```json
{
  "event": "charge.success",
  "data": {
    "reference": "KPY-PAY-4l5O8mxmgX2kijp",
    "currency": "NGN",
    "amount": 1000,
    "fee": 15,
    "status": "success",
    "virtual_bank_account_details": {
      "payer_bank_account": {
        "account_name": "Ope Praise",
        "account_number": "******1001",
        "bank_name": "First Bank Nigeria"
      },
      "virtual_bank_account": {
        "account_name": "Afro Jon",
        "account_number": "0657789765",
        "account_reference": "{{your_account_reference}}",
        "bank_name": "Fidelity Bank"
      }
    },
    "transaction_date": "2021-09-08T12:06:28.309Z"
  }
}
```

# **Getting the details of payment made to Virtual Bank Account**

You can get the details of payment to a Virtual Bank Account by making a GET request to the [Charge Query API](https://docs.korapay.com/#8a602daa-6e83-4118-9ff3-ba8c09ab6f48) endpoint using the reference returned in the webhook notification request payload.

**Endpoint** - `https://api.korapay.com/merchant/api/v1/charges/:reference`

And here's what the response looks like:

```json
{
  "status": true,
  "message": "Charge retrieved successfully",
  "data": {
    "reference": "kpy-pay-123456",
    "status": "success",
    "amount": "100.00",
    "amount_paid": "100.00",
    "fee": 1.5,
    "currency": "NGN",
    "description": "Payment to merchant",
    "customer": {
      "name": "John Doe",
      "email": "johndoe@gmail.com"
    },
    "virtual_bank_account": {
      "account_number": "7650000001",
      "account_name": "John Doe",
      "account_reference": "test-ref",
      "transaction_narration": "NIP: John Doe-7650000001/John Doe",
      "payer_bank_account": {
        "account_number": "3110920293",
        "account_name": "John Doe",   
        "bank_name": "First Bank"
      }
    }
  }
}

```

More details on the payments made to the Virtual Bank Account can be viewed from the Pay-ins page of your dashboard. Simply:

1. [Log in](https://merchant.korapay.com/auth/login) to your dashboard. [Create an account](https://merchant.korapay.com/) if you don’t already have one.
2. Navigate to the Pay-ins page.
3. Search for the transaction using the transaction reference.
4. Click on the transaction to view further details.

# **Fetching the Transactions on an NGN Virtual Bank Account**

All payments made to a Fixed Virtual Bank Account can be retrieved. To do this, you need to make a GET request to the [VBA Transactions Query API](https://docs.korapay.com/#972e66eb-d625-4510-ad60-67e9709b7d04) endpoint.

**Endpoint** - `https://api.korapay.com/merchant/api/v1/virtual-bank-account/transactions`

See the request parameters for this endpoint below:

<Callout icon="📘" theme="info">
  ### Note

  You are to pass the request parameters as a query because it is a GET request. e.g `https://api.korapay.com/merchant/api/v1/virtual-bank-account/transactions?account_number=1003346789`
</Callout>

| Parameter        | Type   | Required | Description                                                                                                                     |
| :--------------- | :----- | :------- | :------------------------------------------------------------------------------------------------------------------------------ |
| `account_number` | String | True     | This is the account number of the Fixed Virtual Bank Account.                                                                   |
| `start_date`     | String | False    | This is the specific date from which you would like the query to start. The expected date format is `YYYY-MM-DD`.               |
| `end_date`       | String | False    | This is the specific end date for the search query. The expected date format is `YYYY-MM-DD`.                                   |
| `page`           | Number | False    | This specifies the page number to retrieve. By default, it is `1`.                                                              |
| `limit`          | Number | False    | This is the maximum number of transactions that can be retrieved at once. By default, this is set to `100` and is configurable. |

Here's a sample response:

```json
{
  "status": true,
  "message": "Virtual bank account transactions retrieved successfully",
  "data": {
    "total_amount_recieved": 3000,
    "account_number": "1003346789",
    "currency": "NGN",
    "transactions": [
      {
        "reference": "kpy-ex-ref-1",
        "status": "success",
        "amount": "3000.00",
        "fee": "0.00",
        "currency": "NGN",
        "description": "Test Payment",
        "payer_bank_account": {
          "account_number": "6376372682",
          "account_name": "Test Payment",
          "bank_name": "Test Bank"
        }
      }
    ],
    "pagination": {
      "page": 1,
      "total": 1,
      "pageCount": 1,
      "totalPages": 1
    }
  }
}
```

# **Suspending and Deleting an NGN Virtual Bank Account**

Virtual Bank Accounts can be suspended and deleted. When an account is suspended or deleted, no payment can be made to such an account.

<Callout icon="📘" theme="info">
  To suspend or delete an account, you’ll need to reach out to [support@korapay.com](mailto:support@korapay.com) with the details of the account and the reason for suspension or deletion.
</Callout>

# **Crediting a Virtual Bank Account on the Sandbox Environment**

Fixed Virtual Accounts on the sandbox environment can be credited with test payments. To do this, you need to make a POST request to the [Credit Sandbox VBA](https://docs.korapay.com/#531895f9-87b9-4f2b-95e8-bfc7a7872deb) endpoint.

**Endpoint** - `https://api.korapay.com/merchant/api/v1/virtual-bank-account/sandbox/credit`

See the request parameters below:

| Parameter        | Type   | Required | Description                                                                                                                        |
| :--------------- | :----- | :------- | :--------------------------------------------------------------------------------------------------------------------------------- |
| `account_number` | String | True     | This is the account number of the Fixed Virtual Bank Account.                                                                      |
| `currency`       | String | True     | This is the currency for the account. Only `NGN` is accepted in this field for now.                                                |
| `amount`         | Number | True     | This is the amount you want to credit to the account. The *minimum* amount is NGN 100, and the *maximum* amount is NGN 10,000,000. |

See an example of a sample response below:

```json
{
  "status": true,
  "message": "Virtual bank account credited successfully",
  "data”: null
}
```

<br />