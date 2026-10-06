---
updatedAt: 2025-05-19T14:44:41.000Z
agentTools:
  projectIndex: https://developers.korapay.com/llms.txt
---

# Balance API

Retrieve your balance information with the Balance API

Balance API is Kora’s product for receiving real-time Balance information. This real-time Balance data can be helpful, for example, when checking to see if your account has sufficient funds before using it as a funding source for a [payout](https://developers.korapay.com/docs/send-payments). With the Balance API, you can easily access your balance without having to log into your dashboard. It also provides you with the liberty and flexibility to incorporate your Korapay Balance into your application however you deem fit.

<br />

### Balance Request

This endpoint returns your Korapay balances (available and pending) and requires secret key authentication.

```javascript Endpoint: Request Balance
{{baseurl}}/merchant/api/v1/balances
```

<br />

### Response

The Balance API automatically returns both the available and pending balances across all supported currencies in the response. By default, balances are provided for NGN, but merchants with multi-currency accounts will also receive balances for other supported currencies, including USD, GHS, KES, XAF, XOF and ZAR.

Here's a sample response:

```json Sample Response
{
    "status": true,
    "message": "success",
    "data": {
  			"NGN": {
            "pending_balance": 100000.78,
            "available_balance": 400300.90
        },
        "USD": {
            "pending_balance": 10000.78,
            "available_balance": 10093756.06,
            "issuing_balance": 17639.67
        }
    }
}
```