---
updatedAt: 2026-08-05T16:02:22.000Z
agentTools:
  projectIndex: https://developers.korapay.com/llms.txt
---

# Nigerian Bank Account Verification

### Nigerian Bank Account lookup API (Premium)

To perform premium verification on a Nigerian bank account (returns account details, BVN, and personal information), make a POST request to the bank account lookup endpoint;

```curl
https://api.korapay.com/merchant/api/v1/identities/ng/bank-account
```

The request body should have the following parameters:

```curl
{
  "id": "0123456789",
  "bank_code": "000013",
  "verification_consent": true
}
```

Request with data matching

```curl
{
  "id": "0123456789",
  "bank_code": "000013",
  "verification_consent": true,
  "validation": {
    "first_name": "john",
    "last_name": "doe",
    "date_of_birth": "1988-04-04"
  }
}
```

| Field                  | Data Type | Description                                                                                                   |
| ---------------------- | --------- | ------------------------------------------------------------------------------------------------------------- |
| `id`                   | string    | Required - 10-digit NUBAN account number                                                                      |
| `bank_code`            | string    | Required - Bank code (3-6 alphanumeric characters). Use GET /identities/ng/banks to retrieve supported banks. |
| `verification_consent` | Boolean   | Required - Indicate subject has given consent. Must be true                                                   |

### Nigerian Bank Account (Premium) response

<br />

* ```curl
  reference
  id
  id_type
  bank_details
  account_details
  bvn
  first_name
  last_name
  middle_name
  address
  validation
  requested_by
  {
    "status": true,
    "message": "Bank account verified successfully",
    "data": {
      "reference": "VR-abc123xyz",
      "id": "0123456789",
      "id_type": "ng_bank_account",
      "first_name": "JOHN",
      "last_name": "DOE",
      "middle_name": "MICHAEL",
      "full_name": "JOHN MICHAEL DOE",
      "gender": "male",
      "date_of_birth": "1990-04-15",
      "bvn": "22222222222",
      "country_of_birth": "Nigeria",
      "country_of_issuance": "Nigeria",
      "expired_date": null,
      "bank_details": {
        "name": "Guaranty Trust Bank",
        "code": "000013"
      },
      "account_details": {
        "number": "0123456789",
        "name": "JOHN MICHAEL DOE",
        "type": "SAVINGS",
        "currency": "NGN"
      },
      "address": {
        "city": "Lagos",
        "town": "Ikeja",
        "lga": "Ikeja",
        "state": "Lagos",
        "street": "12 Allen Avenue"
      },
      "adverse_media_report": null,
      "aml_report": null,
      "validation": {
        "first_name": {
          "value": "john",
          "match": true
        },
        "last_name": {
          "value": "doe",
          "match": true
        },
        "date_of_birth": {
          "value": "1990-04-15",
          "match": true
        }
      },
      "requested_by": "API User"
    }
  }
  ```

### Nigerian Basic Bank Account lookup API

To perform basic verification on a Nigerian bank account (returns account name and bank details only), make a POST request to the basic bank account lookup endpoint;

```curl
https://api.korapay.com/merchant/api/v1/identities/ng/bank-account-basic
```

The request body uses the same parameters as the full bank account endpoint. The `id_type` in the response is `ng_bank_account_basic`&#x20;

#### Nigerian Bank Account (basic) response

<br />

* ```curl
  reference
  id
  id_type
  bank_details
  account_details
  requested_by
  {
      "status": true,
      "message": "Bank account verified successfully",
      "data": {
          "reference": "VR-oR2Zjr6X77U5G73rb",
          "id": "0123456789",
          "id_type": "ng_bank_account_basic",
          "bank_details": {
              "name": "Guaranty Trust Bank",
              "code": "058"
          },
          "account_details": {
              "number": "0123456789",
              "name": "MICHAEL JOHN DOE"
          },
          "requested_by": "API User"
      }
  }
  ```

### Fetch Nigerian Banks

Before verifying a Nigerian bank account, call Fetch Banks with the type that matches your verification tier. The type query parameter is required.

* Premium verification → GET /identities/ng/banks?type=premium
* Basic verification → GET /identities/ng/banks?type=basic

<br />

Using a basic bank code for premium verification (or vice versa) may cause verification to fail. Always pair the correct Fetch Banks type with the matching verification endpoint.

### Fetch Banks (Premium)&#x20;

```text GET
https://api.korapay.com/merchant/api/v1/identities/ng/banks?type=premium
```

**Sample response:**

```curl
{
  "status": true,
  "message": "Banks fetched successfully",
  "data": [
    { "name": "Guaranty Trust Bank", "code": "000013" },
    { "name": "Access Bank", "code": "044" },
    { "name": "Sterling Bank", "code": "000001" }
  ]
}
```

### Fetch Banks (Basic)

```text GET
https://api.korapay.com/merchant/api/v1/identities/ng/banks?type=basic
```

**Sample response:**

```curl
{
  "status": true,
  "message": "Banks fetched successfully",
  "data": [
    { "name": "Guaranty Trust Bank", "code": "058" },
    { "name": "Access Bank", "code": "044" },
    { "name": "Wema Bank", "code": "035" }
  ]
}
```

<Callout icon="📘" theme="info">
  Note: Premium and Basic bank lists and code may differ. A bank on one list may not appear on the other.
</Callout>