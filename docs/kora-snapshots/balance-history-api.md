---
updatedAt: 2025-02-28T00:13:03.000Z
agentTools:
  projectIndex: https://developers.korapay.com/llms.txt
---

# Balance History API

The Balance History API gives merchants the ability to fetch transactions (**pay-ins** or **payouts**) that affect their balance without having to go on the dashboard to get them. The API request provides flexibility for merchants to choose the time frame, currency or type of transactions they want to fetch.

Use this endpoint to get your balance history: `{{baseurl}}/merchant/api/v1/balances/history`

You may also use these parameters in your request to fetch your transactions:

| Field            | Data Type | Description                                                                                                                  |
| :--------------- | :-------- | :--------------------------------------------------------------------------------------------------------------------------- |
| `currency`       | String    | **Optional** - transaction currency e.g. NGN, KES, etc.                                                                      |
| `date_from`      | String    | **Optional** - fetch transactions from this date. Use format `YYYY-MM-DD-HH-MM-SS`.                                          |
| `date_to`        | String    | **Optional** - fetch transactions up to this date. Use format `YYYY-MM-DD-HH-MM-SS`.                                         |
| `limit`          | Number    | **Optional** - If not passed, we send a limit of `10`.                                                                       |
| `starting_after` | String    | **Optional** - used for pagination, must be used separately with `ending_before`, it expects the pointer from the response.  |
| `ending_before`  | String    | **Optional** - used for pagination, must be used separately with `starting_after`, it expects the pointer from the response. |
| `direction`      | String    | **Optional** - the type of transaction - `debit` or `credit`.                                                                |

***

Here's an example of how the response could look like:

```json Sample Response
{
  "has_more": true,
  "data":{
    "pointer": "cus_1B89",
    "amount": "3000.00",
    "currency": "NGN",
    "balance_before": "10811758.99",
    "balance_after": "10808758.99",
    "date_created": "2023-09-08 07:20:00",
    "description": "Chargeback deduction for KPY-CM-s2Ao7BlFCm5FdfG",
    "direction": "debit",
    "source": "chargeback",
    "source_reference": "KPY-CHB-3Xuop6zkvlsyP"
  }
}
```