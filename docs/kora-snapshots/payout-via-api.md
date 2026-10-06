---
updatedAt: 2026-06-07T20:22:38.000Z
agentTools:
  projectIndex: https://developers.korapay.com/llms.txt
---

# Payout API

Payouts on Kora are done using our RESTful APIs, enabling a smooth, solid integration.

If a payout request is triggered, Kora will directly disburse from your positive balance, and notify your application via an API callback when the transfer has been completed.

Furthermore, you can always get the status of a single payout at any time via API or monitor the transaction status on the dashboard, where you can also see the payment details with a reference number for the transaction.

***

## **Use Case**

Let's consider a typical case where your service uses a company eWallet to pay customers, employees, etc.

On your website when a customer requests a payout to their bank account. Your website’s back-end asks Kora to process this payout. Kora processes the payment to the customer’s bank account, then notifies your website’s back-end when the payout has been completed. *Easy peasy!*

Let's take a quick look at how you'll use the Kora API to implement the workflow for this use case. First, we'll look at your high-level workflow. Then we'll explain how to implement the workflow in detail. We'll use a sample code to bring the workflow to life.

### **Workflow - Payout to customer’s bank account**

This is what the workflow would look like from a birds-eye view.

***

*Stage 1 - Requesting a Payout*

![](https://files.readme.io/6834ec2-disb_1.png "disb 1.png")

1. On your website, a payout request is made by a customer.
2. Your website back-end asks Kora to process the payout.

***

*Stage 2 - Processing the Payout*

![](https://files.readme.io/336e072-disb_2.png "disb 2.png")

1. Kora processes the payout.
2. The customer's bank account is credited with funds from the merchant’s eWallet.
3. Your Kora dashboard or application is notified that the money was credited to the bank account

***

# Implementing the Payout Workflow

Now, let’s dive deeper into how this workflow would be implemented end-to-end.

Step 1 - Use [List banks](https://docs.korapay.com/?version=latest#82cbd8bc-00a2-4ed4-8c64-a10654e31ea6) API to get valid bank codes, or use [List MMO](https://docs.korapay.com/?version=latest#9a13d891-2fc9-4bce-864c-5d7919eb845f) API to get valid mobile money operator slugs.

Step 2 - [Verify](https://docs.korapay.com/?version=latest#05b2fb87-ee57-4a2c-b07b-bb050b6b58e7) the destination bank account - Optional

Step 3 - Request [payout](https://docs.korapay.com/?version=latest#9e0b5372-ba48-49f6-ae90-c5d66903bed0)

Step 4 - Receive confirmation via webhook when the payout is completed

Step 5 - [Query](https://docs.korapay.com/?version=latest#ce2440eb-4576-4106-ba6f-bda9e8f4e06a) the transaction to get the status of the transaction.

> 📘 Before you start:
>
> Make sure to check out [Quick Start](https://developers.korapay.com/docs/quick-start) learn more about [Test and Live Modes](https://developers.korapay.com/docs/quick-start#test-mode-vs-live-mode), as well as API keys and how to use them.

***

# **1 - Find bank codes from[ List Banks](https://docs.korapay.com/?version=latest#82cbd8bc-00a2-4ed4-8c64-a10654e31ea6) or mobile money operators slug from [List MMO](https://docs.korapay.com/?version=latest#9a13d891-2fc9-4bce-864c-5d7919eb845f)**

For a successful payout, you need to input the destination bank of the transaction in the bank field. This means you need to get details of the direct bank for that beneficiary (e.g, Access Bank, ABSA or Wema Bank, etc).

In this example, you'll find the different bank types that allow transfers in the currencies that we support.

**Request Banks Type**

Request for a list of all available bank codes for transfers in Nigeria, Kenya and South Africa.

```json Nigeria
{{baseurl}}/merchant/api/v1/misc/banks?countryCode=NG
```
```json Kenya
{{baseurl}}/merchant/api/v1/misc/banks?countryCode=KE
```
```json South Africa
{{baseurl}}/merchant/api/v1/misc/banks?countryCode=ZA
```

**Banks Type response**

This is an example response to the request for bank type

```json Nigeria
{
  "status": true,
  "message": "success",
  "data": [
    {
      "name": " Bank name", // e.g Access Bank Nigeria
      "slug": " Bank slug", // e.g access
      "code": " Bank code", // e.g 044
      "country": "NG"
    },
  ]
}
```
```json Kenya
{
  "status": true,
  "message": "success",
  "data": [
    {
      "name": "ABC Bank", // e.g ABC Bank Kenya
      "slug": " Bank slug", // e.g abc-bank-ke
      "code": " Bank code", // e.g 0035
      "country": "KE"
    },
  ]
}
```
```json South Africa
{
  "status": true,
  "message": "success",
  "data": [
    {
      "name": "Bank Name", // e.g ABSA
      "slug": " Bank slug", // e.g absa-za
      "code": " Bank code", // e.g 632005
      "country": "ZA"
    },
  ]
}
```

***

For a successful mobile money payout, you need to input the mobile money operator slug of the transaction in the `mobile_money.operator` field. This means you need to get details of the beneficiary's mobile money operator. For example, Safaricom (Mpesa) or Airtel.

In this example, you'll find the different mobile money operator types that allow transfers in the currencies supported on Kora.

**Request Mobile Operator Type (Kenya)**

Request for a list of all available mobile operators enabled for transfers in Kenya and their payout limits.

```json Request
{{baseurl}}/merchant/api/v1/misc/mobile-money?countryCode=KE
```

Here's an example response to the request for mobile money type:

```json Response
{
  "status": true,
  "message": "success",
  "data": [
    {
      "name": " Mobile money operator name", // e.g Safaricom
      "slug": " Mobile money operator slug", // e.g safaricom-ke
      "code": " Mobile Money code", // e.g 0001
      "country": "KE",
      "min":  10,
      "max": 70000
    },
  ]
}
```

***

**Request Mobile Operator Type (Ghana)**

Request for a list of all available mobile operators enabled for transfers in Ghana and their payout limits.

```json Request
{{baseurl}}/merchant/api/v1/misc/mobile-money?countryCode=GH
```

Here's an example of the response to a request for mobile money type:

```json Response
{
  "status": true,
  "message": "success",
  "data": [
    {
      "name": " Mobile money operator name", // e.g MTN
      "slug": " Mobile money operator slug", // e.g mtn-gh
      "code": " Mobile Money code", // e.g 0004
      "country": "GH",
      “min”:  10,
      “max”: 100000
    },
  ]
}
```

# **2 - Verify the destination bank account - Optional**

### Bank account verification for Nigerian and Kenyan Banks

Use Bank Account Resolve API to resolve the bank accounts (Kenya and Nigeria) before you request the payout. See the Verification request and response below.

**Bank Account Resolve request**

This resolves the bank account:

```Text Request
{{baseurl}}/merchant/api/v1/misc/banks/resolve
```

**Request body**

The following parameters should be included in the request body.

| Field      | Data Type | Description                                   |
| :--------- | :-------- | :-------------------------------------------- |
| `bank`     | String    | **Required** - bank code of account number    |
| `account`  | String    | **Required** - account number to be resolved  |
| `currency` | String    | **Required** - country currency. E.g, KE, NG. |

**Bank Account Resolve response**

Here’s how the response should look like.

```json
{
  "status": true,
  "message": "Request Completed",
  "data": {
    "bank_name": "United Bank for Africa",
    "bank_code": "033",
    "account_number": "2158634852",
    "account_name": "EBUKA CIROMA OLADEMJI"
  }
}
```

### Mobile Money account verification for Ghanaian mobile money networks

Use the Mobile Money Account Resolve API to resolve the mobile money account before you request the payout. See the request and response below.

**Mobile Money Account Resolve request**

```json Request
{{baseurl}}/merchant/api/v1/misc/mobile-money/resolve
```

**Request body**

The following parameters should be included in the request body.

| Field             | Data Type | Description                                   |
| :---------------- | :-------- | :-------------------------------------------- |
| `mobileMoneyCode` | String    | **Required** - code for mobile money operator |
| `phoneNumber`     | String    | **Required** - phone number to be resolved    |
| `currency`        | String    | **Required** - country currency. E.g, GH.     |

**Response**

Here’s how the response should look like.

```json
{
  "status": true,
  "message": "Request Completed",
  "data": {
    "mobile_money_operator": "MTN GH",
    "mobile_money_code": "0004",
    "phone_number": "233722222222",
    "account_name": "EBUKA CIROMA OLADEMJI"
  }
}
```

***

# **3 - Check availability of Bank or Mobile Money network (MMN) - Optional**

Use the Availability API to confirm a bank or Mobile Money network availability before you request the payout. See the request and response below.

<Callout icon="ℹ️" theme="info">
  Please note that this service is currently only available for South African payouts.
</Callout>

**Bank or Mobile Money Availability**

```json Request
{{baseurl}}/merchant/api/v1/payouts/availability
```

**Request Body**

| Field      | Data Type | Description                                                      |
| :--------- | :-------- | :--------------------------------------------------------------- |
| `type`     | String    | **Required** - payment method e.g `bank_account`, `mobile_money` |
| `currency` | String    | **Required** - country currency. E.g, ZAR.                       |

**Response**

Here's an example of what a response would look like:

```json Response
{
  "status": true,
  "message": "Request Completed",
  "data":{
		"name": "ABSA",
		"slug": "absa-za",
		"code": "632005",
		"country": "ZA",
    "status": "delayed"
	},
  {
		"name": "African Bank",
		"slug": "african-bank-za",
		"code": "430000",
  	"country": "ZA",
		"status": "delayed"
	}
}

```

**Availability statuses and meaning**

* If the response returned is `Available`, your payout request will be processed instantly.
* If the response returned is `Delayed`, your payout request will not be processed instantly due to delay from the Bank or Mobile Money network but it will be processed at a later time.
* If the response returned is `Unavailable`,  your payout request will not be processed within the period the request is made due to a possible downtime from the Bank or Mobile Money network.

***

# **4a - Request Payout**

For this, you'll use the [Payout API](https://docs.korapay.com/#9e0b5372-ba48-49f6-ae90-c5d66903bed0)

`{{baseurl}}/merchant/api/v1/transactions/disburse`

**Payout Request**

You need to find the required field for each payout request.

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
        `reference`
      </td>

      <td>
        String
      </td>

      <td>
        **Required** - unique transaction reference **(must be at least 5 characters long)**.
      </td>
    </tr>

    <tr>
      <td>
        `destination`
      </td>

      <td>
        Object
      </td>

      <td>
        **Required**
      </td>
    </tr>

    <tr>
      <td>
        `destination.type`
      </td>

      <td>
        String
      </td>

      <td>
        **Required** - can be `bank_account` or `mobile_money`
      </td>
    </tr>

    <tr>
      <td>
        `destination.amount`
      </td>

      <td>
        Number
      </td>

      <td>
        **Required** - transaction amount in two decimal places.
      </td>
    </tr>

    <tr>
      <td>
        `destination.currency`
      </td>

      <td>
        String
      </td>

      <td>
        **Required** - transaction currency e.g. NGN, KES, GHS, XOF, XAF, EGP, ZAR or USD
      </td>
    </tr>

    <tr>
      <td>
        `destination.narration`
      </td>

      <td>
        String
      </td>

      <td>
        _Optional_ - transaction narration or description
      </td>
    </tr>

    <tr>
      <td>
        `destination.mobile_money`
      </td>

      <td>
        Object
      </td>

      <td>
        **Required** - if destination type is _`mobile_money`_
      </td>
    </tr>

    <tr>
      <td>
        `destination.mobile_money.operator`
      </td>

      <td>
        String
      </td>

      <td>
        **Required** - if destination.type is `mobile_money`, the mobile money operator slug, e.g., `safaricom-ke`.
      </td>
    </tr>

    <tr>
      <td>
        `destination.mobile_money.mobile_number`
      </td>

      <td>
        String
      </td>

      <td>
        **Required** - if destination.type is `mobile_money`, the mobile number attached to the mobile money account.
      </td>
    </tr>

    <tr>
      <td>
        `destination.bank_account`
      </td>

      <td>
        Object
      </td>

      <td>
        **Required** - if destination type is _`bank_account`_
      </td>
    </tr>

    <tr>
      <td>
        `destination.bank_country`
      </td>

      <td>
        String
      </td>

      <td>
        **Required** - if currency is USD or GBP and type is bank_account  — The country of the destination bank, see list of all supported destination bank countries [here](https://developers.korapay.com/docs/payout-utilities#get-supported-bank-countries-by-currency-code-1).
      </td>
    </tr>

    <tr>
      <td>
        `destination.bank_account.bank`
      </td>

      <td>
        String
      </td>

      <td>
        **Required** - This is the recipient bank code, if _currency_ is NOT `USD` or `GBP`. Some bank codes that you can use to simulate successful transactions in Test mode are 044, 033, 058 (i.e.for  Access Bank, UBA and GTCO respectively). See the bank details for other test scenarios [here](https://developers.korapay.com/docs/testing-your-integration#test-bank-accounts-for-payouts)
      </td>
    </tr>

    <tr>
      <td>
        `destination.bank_account.account`
      </td>

      <td>
        String
      </td>

      <td>
        **Required** - recipient account number
      </td>
    </tr>

    <tr>
      <td>
        `destination.customer`
      </td>

      <td>
        Object
      </td>

      <td>
        **Required**
      </td>
    </tr>

    <tr>
      <td>
        `destination.customer.name`
      </td>

      <td>
        String
      </td>

      <td>
        _Optional_ - Customer Name
      </td>
    </tr>

    <tr>
      <td>
        `destination.customer.email`
      </td>

      <td>
        String
      </td>

      <td>
        **Required** - Customer Email
      </td>
    </tr>

    <tr>
      <td>
        `destination.bank_account.bank_name`
      </td>

      <td>
        String
      </td>

      <td>
        **Required** - if currency is `USD` or `GBP`
      </td>
    </tr>

    <tr>
      <td>
        `destination.bank_account.beneficiary_type`
      </td>

      <td>
        String
      </td>

      <td>
        **Required** - if currency is `USD` or `GBP`. It can either be:

        * Individual (`individual`), or
        * Corporate (`corporate`).
      </td>
    </tr>

    <tr>
      <td>
        `destination.bank_account.first_name`
      </td>

      <td>
        String
      </td>

      <td>
        **Required** - if currency is `USD` or `GBP`
      </td>
    </tr>

    <tr>
      <td>
        `destination.bank_account.last_name`
      </td>

      <td>
        String
      </td>

      <td>
        **Required** - if currency is `USD` or `GBP`.
      </td>
    </tr>

    <tr>
      <td>
        `destination.bank_account.business_name`
      </td>

      <td>
        String
      </td>

      <td>
        **Required** - if currency is `USD` or `GBP`, and `beneficiary_type` is `corporate`.
      </td>
    </tr>

    <tr>
      <td>
        `destination.bank_account.account_type`
      </td>

      <td>
        String
      </td>

      <td>
        **Required** - if currency is `USD` or `GBP`. It can either be Savings (`savings`) or Checking (`checking`).
      </td>
    </tr>

    <tr>
      <td>
        `destination.bank_account.account_number_type`
      </td>

      <td>
        String
      </td>

      <td>
        **Required** - if currency is `USD` or `GBP`. It can either be Account number (`account_number`) or IBAN (`iban`).
      </td>
    </tr>

    <tr>
      <td>
        `destination.bank_account.payment_method`
      </td>

      <td>
        String
      </td>

      <td>
        **Required** - if currency is `USD` or `GBP`.

        * For USD
          * Local: `AbaRouting`
          * International: `BicSwift`
        * For GBP:
          * Local: `SortCode`
          * International: `IBAN`
      </td>
    </tr>

    <tr>
      <td>
        `destination.bank_account.routing_number`
      </td>

      <td>
        String
      </td>

      <td>
        **Required** - if currency is `USD` or `GBP`

        * For USD
          * Local: Routing number
          * International: Swift code
        * For GBP:
          * Local:  Sort code
          * International: Swift code
      </td>
    </tr>

    <tr>
      <td>
        destination.bank_account.intermediary_routing_number
      </td>

      <td>
        String
      </td>

      <td>
        **Required** - if currency is `USD` or `GBP`, and `payment_method` is `BicSwift`.
      </td>
    </tr>

    <tr>
      <td>
        `destination.bank_account.address_information`
      </td>

      <td>
        Object
      </td>

      <td>
        **Required** - if currency is `USD` or `GBP`
      </td>
    </tr>

    <tr>
      <td>
        `destination.bank_account.address_information.country`
      </td>

      <td>
        String
      </td>

      <td>
        **Required** - if currency is `USD` or `GBP`
      </td>
    </tr>

    <tr>
      <td>
        `destination.bank_account.address_information.city`
      </td>

      <td>
        String
      </td>

      <td>
        **Required** - if currency is `USD` or `GBP`
      </td>
    </tr>

    <tr>
      <td>
        `destination.bank_account.address_information.state`
      </td>

      <td>
        String
      </td>

      <td>
        **Required** - if currency is `USD` or `GBP`
      </td>
    </tr>

    <tr>
      <td>
        `destination.bank_account.address_information.zip_code`
      </td>

      <td>
        String
      </td>

      <td>
        **Required** - if currency is `USD` or `GBP`
      </td>
    </tr>

    <tr>
      <td>
        `destination.bank_account.address_information.street`
      </td>

      <td>
        String
      </td>

      <td>
        **Required** - if currency is `USD` or `GBP`
      </td>
    </tr>

    <tr>
      <td>
        `destination.bank_account.address_information.full_address`
      </td>

      <td>
        String
      </td>

      <td>
        **Required** - if currency is `USD` or `GBP`
      </td>
    </tr>

    <tr>
      <td>
        `destination.supporting_documents`
      </td>

      <td>
        Array
      </td>

      <td>
        **Required** - if currency is `USD` or `GBP`
      </td>
    </tr>

    <tr>
      <td>
        `destination.supporting_documents[0].title`
      </td>

      <td>
        String
      </td>

      <td>
        **Required** - if currency is `USD` or `GBP`. This is the name of the document (e.g invoice, receipt, etc)
      </td>
    </tr>

    <tr>
      <td>
        `destination.supporting_documents[0].file_reference`
      </td>

      <td>
        String
      </td>

      <td>
        **Required** - if currency is `USD` or `GBP`. This can be gotten from the reference [here](https://developers.korapay.com/docs/supporting-documents)
      </td>
    </tr>

    <tr>
      <td>
        `destination.purpose_of_payment`
      </td>

      <td>
        String
      </td>

      <td>
        Optional Used with USD, GBP Non African Currencies. See list of countries requiring payment purposes [here](https://developers.korapay.com/docs/payout-utilities#get-payment-purposes-by-country-code-3)
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
        _Optional_ - It takes a JSON object with a maximum of 5 fields/keys. Empty JSON objects are not allowed.

        Each field name has a maximum length of 20 characters. Allowed characters: `A-Z`, `a-z`, `0-9`, `-`.
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
        Optional - valid url where webhook notifications for this transaction will be delivered. If not provided, notifications are sent to your default webhook url
      </td>
    </tr>
  </tbody>
</Table>

<br />

# **4b. Request Payout (For remittance merchants)**

In the case of remittance, use the following Payout API endpoint

`{{baseurl}}/api/v1/transactions/disburse/remittance`

**Payout Remittance Request**

These are the parameters for the request (you'll need to find the required field for each payout request):

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
        `reference`
      </td>

      <td>
        String
      </td>

      <td>
        **Required** - unique transaction reference.
      </td>
    </tr>

    <tr>
      <td>
        `destination`
      </td>

      <td>
        Object
      </td>

      <td>
        **Required** - this is the payout destination.
      </td>
    </tr>

    <tr>
      <td>
        `destination.type`
      </td>

      <td>
        String
      </td>

      <td>
        **Required** - can be `bank_account` or `mobile_money`.
      </td>
    </tr>

    <tr>
      <td>
        `destination.amount`
      </td>

      <td>
        Number
      </td>

      <td>
        **Required** - transaction amount in two decimal places.
      </td>
    </tr>

    <tr>
      <td>
        `destination.currency`
      </td>

      <td>
        String
      </td>

      <td>
        **Required** - transaction currency e.g. NGN, KES, GHS, XOF, XAF or USD
      </td>
    </tr>

    <tr>
      <td>
        `destination.narration`
      </td>

      <td>
        String
      </td>

      <td>
        _Optional_ - transaction narration or description.
      </td>
    </tr>

    <tr>
      <td>
        `destination.bank_account`
      </td>

      <td>
        Object
      </td>

      <td>
        **Required** - if `destination.type` is `bank_account`.
      </td>
    </tr>

    <tr>
      <td>
        `destination.bank_account.bank`
      </td>

      <td>
        String
      </td>

      <td>
        **Required** - recipient bank code. Some bank codes that you can use to simulate successful transactions in test mode are `044`, `033`, `058` (i.e. for Access Bank, UBA and GTCO respectively). See the bank details for other test scenarios [here](https://developers.korapay.com/docs/testing-your-integration)
      </td>
    </tr>

    <tr>
      <td>
        `destination.bank_account.account`
      </td>

      <td>
        String
      </td>

      <td>
        **Required** - recipient account number.
      </td>
    </tr>

    <tr>
      <td>
        `destination.bank_account.account_name`
      </td>

      <td>
        String
      </td>

      <td>
        **Required** - if `currency` is `ZAR`
      </td>
    </tr>

    <tr>
      <td>
        `destination.mobile_money`
      </td>

      <td>
        Object
      </td>

      <td>
        **Required** - if `destination.type` is `mobile_money`
      </td>
    </tr>

    <tr>
      <td>
        `destination.mobile_money.operator`
      </td>

      <td>
        String
      </td>

      <td>
        **Required** - if `destination.type` is `mobile_money`.

        This is the mobile money operator slug. E.g, `safaricom-ke`.
      </td>
    </tr>

    <tr>
      <td>
        `destination.mobile_money.mobile_number`
      </td>

      <td>
        String
      </td>

      <td>
        **Required** - if `destination.type` is `mobile_money`.

        This is the mobile number attached to the mobile money account.
      </td>
    </tr>

    <tr>
      <td>
        `destination.customer`
      </td>

      <td>
        Object
      </td>

      <td>
        **Required** - this is the customer object.
      </td>
    </tr>

    <tr>
      <td>
        `destination.customer.name`
      </td>

      <td>
        String
      </td>

      <td>
        _Optional_ - the customer's full name.
      </td>
    </tr>

    <tr>
      <td>
        `destination.customer.email`
      </td>

      <td>
        String
      </td>

      <td>
        **Required** - the customer's email.
      </td>
    </tr>

    <tr>
      <td>
        `remittance_data`
      </td>

      <td>
        Object
      </td>

      <td>
        **Required** - the remittance data object.
      </td>
    </tr>

    <tr>
      <td>
        `remittance_data.sender_name`
      </td>

      <td>
        String
      </td>

      <td>
        **Required** - the full name of the sender.
      </td>
    </tr>

    <tr>
      <td>
        `remittance_data.sender_phone_number`
      </td>

      <td>
        String
      </td>

      <td>
        _Optional_ - the phone number of the sender.
      </td>
    </tr>

    <tr>
      <td>
        `remittance_data.sender_dob`
      </td>

      <td>
        String
      </td>

      <td>
        _Optional_ - the date of birth of the sender in the format `YYYY-MM-DD`, e.g. `1990-05-15`.
      </td>
    </tr>

    <tr>
      <td>
        `remittance_data.sender_country_iso`
      </td>

      <td>
        String
      </td>

      <td>
        _Optional_ - the 2-digit country ISO code of sender, e.g. `NG` for Nigeria.
      </td>
    </tr>

    <tr>
      <td>
        `remittance_data.sender_nationality`
      </td>

      <td>
        String
      </td>

      <td>
        _Optional_ - the nationality of the sender, e.g. `Nigerian`.
      </td>
    </tr>

    <tr>
      <td>
        `remittance_data.sender_id_type`
      </td>

      <td>
        String
      </td>

      <td>
        _Optional_ - the identification type of the sender, e.g. `passport`.
      </td>
    </tr>

    <tr>
      <td>
        `remittance_data.sender_id_number`
      </td>

      <td>
        String
      </td>

      <td>
        _Optional_ - the identification type number of the sender, e.g. `A12345678`.
      </td>
    </tr>

    <tr>
      <td>
        `remittance_data.sender_service_provider_name`
      </td>

      <td>
        String
      </td>

      <td>
        _Optional_ - the name of the provider, e.g. `ABC Bank`.
      </td>
    </tr>

    <tr>
      <td>
        `remittance_data.remittance_purpose`
      </td>

      <td>
        String
      </td>

      <td>
        _Optional_ - the purpose of the remittance, e.g. `Family Support`.
      </td>
    </tr>

    <tr>
      <td>
        `remittance_data.sender_recipient_relationship`
      </td>

      <td>
        String
      </td>

      <td>
        _Optional_ - the relationship between the sender and the recipient, e.g, `Sibling`.
      </td>
    </tr>

    <tr>
      <td>
        `remittance_data.sender_occupation`
      </td>

      <td>
        String
      </td>

      <td>
        _Optional_ - the occupation of the sender, e.g. `Software Engineer`.
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
        _Optional_ - It takes a JSON object with a maximum of 5 fields/keys. Empty JSON objects are not allowed.

        Each field name has a maximum length of 20 characters. Allowed characters: `A-Z,` `a-z`, `0-9`, `-`.
      </td>
    </tr>
  </tbody>
</Table>

Here's an example of how the request would look like:

```json Sample Request (Remittance)
{
   "reference": "KPY-D-t74azVrw9oPLtv9",
   "destination": {
        "type": "mobile_money",
        "amount": 100,
        "currency": "GHS",
        "narration": "Test Transfer Payment backend",
        "mobile_money": {
            "operator": "MTN",
            "mobile_number": "233244300001"
        },
        "customer": {
            "name": "Sally",
            "email": "sally@example.com"
        }
    },
   "remittance_data": {
        "sender_name": "Sally Okunola",
        "sender_phone_number": "086778899001",
        "sender_dob": "1990-01-31",
        "sender_country_iso": "NG",
        "sender_nationality": "Nigerian",
        "sender_id_type": "Passport",
        "sender_id_number": "A12345678",
        "sender_service_provider_name": "ABC Bank",
        "remittance_purpose": "Family Support",
        "sender_recipient_relationship": "Brother",
        "source_of_funds": "Salary",
        "sender_occupation": "Software Engineer"
   }
}
```

<br />

**Payout Response**

Here’s how the response for your payout (regular/remittance) request should look like:

```json Sample Response (Regular)
{
  "status": true,
  "message": "transfer initiated successfully",
  "data": {
    "amount": "100.00",
    "fee": "2.50",
    "currency": "NGN",
    "status": "processing",
    "reference": "KPY-D-t74azVrw9oPLtv9",
    "narration": "Test Transfer Payment",
    "message": "Payout processing",
    "customer": {
      "name": "John Doe",
      "email": "johndoe@sample.com",
      "phone": null
    },
    "metadata": {
      "internalRef": "JD-12-67",
      "age": 15,
      "fixed": true,
    }
  }
}
```
```json Sample Response (Remittance)
{
  "status": true,
  "message": "Remittance transfer initiated successfully.",
  "data": {
	"amount": "100.00",
	"fee": "2.50",
	"currency": "NGN",
	"status": "processing",
	"reference": "KPY-D-t74azVrw9oPLtv9",
	"narration": "Test Transfer Payment",
               "message": "Payout processing",
	"customer": {
  	      "name": "John Doe",
  	      "email": "johndoe@korapay.com",
  	      "phone": null
	}
  }
}
```

<br />

<br />

<Callout icon="🚧" theme="warn">
  **Note:** For payouts in XAF and XOF, you are ONLY allowed to pay out amounts in multiples of 5s and 10s. This means that amounts like XAF 101 or XAF 98 will not be accepted unless they are either rounded up (110 or 100) or down (100 or 95) in order to be processed successfully.
</Callout>

***

### **Encrypting your request payload (optional)**

If you wish to encrypt the payload for your requests, you can do so by following these steps:

1. Stringify the payload generated from the previous step.
2. Encrypt using AES-256 algorithm. Your encryption key can be found under the [API configuration tab](https://merchant.korapay.com/dashboard/settings/api-integrations) in the **Settings** page of your dashboard.
3. Send the generated encrypted string in your request body as `encrypted_data` as shown below. `{“encrypted_data”: “your-generated-encrypted-string”}`

<br />

You can find some sample code snippets below showing a function that handles AES-256 encryption.

```javascript
// Javascript
const crypto = require("crypto");

function encryptAES256(encryptionKey, paymentData) {  
  const iv = crypto.randomBytes(16);

  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  const encrypted = cipher.update(paymentData);

  const ivToHex = iv.toString('hex');
  const encryptedToHex = Buffer.concat([encrypted, cipher.final()]).toString('hex');
  
  return `${ivToHex}:${encryptedToHex}:${cipher.getAuthTag().toString('hex')}`;
}
```
```php
// PHP
function encryptAES256($encryptionKey, $paymentData) {
     $method = "aes-256-gcm";
    $iv = openssl_random_pseudo_bytes(16);
    $tag = "";
    $cipherText = openssl_encrypt($paymentData, $method, $encryptionKey, OPENSSL_RAW_DATA, $iv, $tag, "", 16);
    return bin2hex($iv).':'.bin2hex($cipherText).':'.bin2hex($tag);
}
```
```python
#Python
# run pip install pycryptodome to use the GCM Mode
import json
from Crypto.Cipher import AES
from Crypto import Random
import base64
from binascii import hexlify as hexa

def encryptAES256(encryptionKey, paymentData):
     try:
         iv = Random.get_random_bytes(16)
         encObj = AES.new(encryptionKey.encode("utf8"), AES.MODE_GCM, iv)
         cipherText,authTag = encObj.encrypt_and_digest(paymentData.encode("utf8"))
         iv64 = base64.b64encode(iv).decode('ascii')
         ivToHex = hexa(iv).decode()
         cipherTextToHex = hexa(cipherText).decode()
         authTagToHex = hexa(authTag).decode()
         result = ivToHex + ":" + cipherTextToHex + ":" + authTagToHex
         return result
     except Exception as e:
         print(e)
```
```java
// Java
import java.security.SecureRandom;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

public class Encryption {
    private static final char[] HEX_ARRAY = "0123456789abcdef".toCharArray();

    private static String bytesToHex(byte[] bytes) {
        char[] hexChars = new char[bytes.length * 2];
        for (int j = 0; j < bytes.length; j++) {
            int v = bytes[j] & 0xFF;
            hexChars[j * 2] = HEX_ARRAY[v >>> 4];
            hexChars[j * 2 + 1] = HEX_ARRAY[v & 0x0F];
        }
        return new String(hexChars);
    }

    private static byte[] encryptDataWithAes(byte[] plainText, byte[] aesKey, byte[] aesIv) throws Exception {
            GCMParameterSpec gcmSpec = new GCMParameterSpec(128, aesIv);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            SecretKeySpec   secretKeySpec = new SecretKeySpec(aesKey, "AES");
            cipher.init(Cipher.ENCRYPT_MODE, secretKeySpec, gcmSpec);
            byte[] cipherText = cipher.doFinal(plainText);

            return cipherText;
   }

    public static String encryptPayload(String payload, String key) throws Exception {
            SecureRandom r = new SecureRandom();

            byte[] ivBytes = new byte[16];
            r.nextBytes(ivBytes);

            byte[] keyBytes   = key.getBytes(StandardCharsets.UTF_8);
            byte[] inputBytes = payload.getBytes(StandardCharsets.UTF_8);
            byte[] encryptedBytes = encryptDataWithAes(inputBytes, keyBytes, ivBytes);
            
            byte[] cipherTextBytes = Arrays.copyOfRange(encryptedBytes, 0, payload.length());
            byte[] authTagBytes = Arrays.copyOfRange(encryptedBytes, payload.length(), encryptedBytes.length);
        
            String ivHex = bytesToHex(ivBytes);
            String encryptedHex = bytesToHex(cipherTextBytes);
            String authTagHex = bytesToHex(authTagBytes);
                        
            String result = new StringBuilder()
                    .append(ivHex)
                    .append(":")
                    .append(encryptedHex)
                    .append(":")
                    .append(authTagHex)
                    .toString();
            return result;
    }
}
```
```csharp
// C#
using System;
using System.Security.Cryptography;
using System.Text;
using Org.BouncyCastle.Crypto.Modes;
using Org.BouncyCastle.Crypto.Parameters;
using Org.BouncyCastle.Crypto.Engines;

	public static class Encryption
	{
		private static readonly char[] HEX_ARRAY = "0123456789abcdef".ToCharArray();
		private static string BytesToHex(byte[] bytes)
		{
			char[] hexChars = new char[bytes.Length * 2];
			for (int j = 0; j < bytes.Length; j++)
			{
				int v = bytes[j] & 0xFF;
				hexChars[j * 2] = HEX_ARRAY[v >> 4];
				hexChars[j * 2 + 1] = HEX_ARRAY[v & 0x0F];
			}

			return new string (hexChars);
		}

		private static byte[] EncryptDataWithAes(byte[] plainText, byte[] aesKey, byte[] aesIv)
		{
			var cipher = new GcmBlockCipher(new AesEngine());
			var keyParam = new KeyParameter(aesKey);
			var ivParam = new ParametersWithIV(keyParam, aesIv);
			cipher.Init(true, ivParam);
			byte[] cipherText = new byte[cipher.GetOutputSize(plainText.Length)];
			int len = cipher.ProcessBytes(plainText, 0, plainText.Length, cipherText, 0);
			cipher.DoFinal(cipherText, len);
			return cipherText;
		}

		public static string EncryptPayload(string payload, string encryptionKey)
		{
			using RandomNumberGenerator r = RandomNumberGenerator.Create();
			byte[] ivBytes = new byte[16];
			r.GetBytes(ivBytes);
			byte[] keyBytes = Encoding.UTF8.GetBytes(encryptionKey);
			byte[] inputBytes = Encoding.UTF8.GetBytes(payload);
			byte[] encryptedBytes = EncryptDataWithAes(inputBytes, keyBytes, ivBytes);
			byte[] cipherTextBytes = encryptedBytes[..payload.Length];
			byte[] authTagBytes = encryptedBytes[payload.Length..];
			string ivHex = BytesToHex(ivBytes);
			string encryptedHex = BytesToHex(cipherTextBytes);
			string authTagHex = BytesToHex(authTagBytes);
			string result = $"{ivHex}:{encryptedHex}:{authTagHex}";
			return result;
		}
	}
```

***

### **Handling Unexpected Request Errors**

When you initiate a payout, **DO NOT** treat request errors such as 502 Bad Gateway, 504 Gateway Timeout, 503 Service Unavailable, 500 Internal Server Error, etc, as failed payout. If you receive any of the errors or any other unexpected error, we strongly recommend that you verify the payout using the [Payout Verification API](https://docs.korapay.com/?version=latest#ce2440eb-4576-4106-ba6f-bda9e8f4e06a) before giving value or completing the transaction.

Whenever an unexpected request error occurs, it’s possible that the payout may have been accepted and processed by Kora. Following this recommendation will prevent the possibility of a financial loss.

You can find a list of possible payout errors and how to treat them [here](https://developers.korapay.com/docs/errors#payout-errors).

<Callout icon="🚧" theme="warn">
  Verifying the payout before completing the transaction and providing value to the customer is strongly recommended. **Please note that Kora will not be liable for any loss resulting from these errors.**
</Callout>

***

# **Payout History API**

The Payout History API allows you to fetch all the payout transactions made from your Kora account without having to get them from the dashboard. Use the endpoint below to fetch your payout history. (*NOTE: It accepts your secret key as the authorization header*)

`{{baseurl}}/merchant/api/v1/payouts`

The parameters for this request query include:

| Field            | Data Type | Description                                                                                                                  |
| :--------------- | :-------- | :--------------------------------------------------------------------------------------------------------------------------- |
| `currency`       | String    | **Optional** - transaction currency e.g. `NGN`, `KES`, `GHS`, `ZAR`,  etc.                                                   |
| `date_from`      | String    | **Optional** - fetch transactions from this date. Use format `YYYY-MM-DD-HH-MM-SS`.                                          |
| `date_to`        | String    | **Optional** - fetch transactions up to this date. Use format `YYYY-MM-DD-HH-MM-SS`.                                         |
| `limit`          | Number    | **Optional** - If not passed, we send a limit of `10`.                                                                       |
| `starting_after` | String    | **Optional** - used for pagination, must be used separately with `ending_before`, it expects the pointer from the response.  |
| `ending_before`  | String    | **Optional** - used for pagination, must be used separately with `starting_after`, it expects the pointer from the response. |

***

Here's an example of how the response could look like:

```json Sample Response
{
  "has_more": true,
  "data": {
    "pointer": "cus_16FC",
    "reference": "555780645",
    "status": "success",
    "amount": "1500.00",
    "fee": "40.31",
    "currency": "NGN",
    "narration": "Transfer from Young and free",
    "trace_id": "14530184957",
    "message": "Payout successful",
    "customer_name": "John Doe",
    "customer_email": "johndoe@sample.com",
    "date_created": "2023-09-07 07:16:04",
    "date_completed": "2023-09-07 07:18:17"
  }
}
```

# **Receive confirmation via webhook**

You can set your application to receive a confirmation via webhooks when the payout is completed. Please visit [Webhooks](https://developers.korapay.com/docs/webhooks) to see more information about the webhook request body and how to verify and handle the webhook request.