---
updatedAt: 2026-09-25T15:09:30.000Z
agentTools:
  projectIndex: https://developers.korapay.com/llms.txt
---

# Webhooks

Webhooks provide a way to receive notifications for your transactions in real time. While your transaction is being processed, its status progresses until it is completed. This makes it very important to get the final status for that transaction, and that's where webhooks are very beneficial.

Put simply, a webhook URL is an endpoint on your server that can receive API requests from Korapay’s server. Note that the request is going to be an **HTTP POST request**.

## Setting your Webhook URL

You can specify your webhook URL in the API Configuration tab of the Settings page of your dashboard to  receive webhooks for Payouts, Chargeback, and Fixed VBAs. Make sure that the webhook URL is unauthenticated and publicly available.

<Image src="https://files.readme.io/953bbec-Screenshot_2023-02-14_at_10.02.28_AM.png" align="center" />

The request to the webhook URL comes with a payload, and this payload contains the details of the transaction for which you are being notified.

## Webhook Notification Request Payload Definitions

| Field            | Data Type | Description                                                                                                     |
| :--------------- | :-------- | :-------------------------------------------------------------------------------------------------------------- |
| `event`          | String    | `transfer.success`,  `transfer.failed`,  `charge.success` or `charge.failed`, `refund.success`, `refund.failed` |
| `data`           | Object    | The object containing transaction details: amount, fee, currency, status, reference                             |
| `data.amount`    | Number    | Transaction amount                                                                                              |
| `data.fee`       | Number    | Transaction fee                                                                                                 |
| `data.currency`  | String    | Transaction currency                                                                                            |
| `data.status`    | String    | Transaction status. This can be `success` or `failed`.                                                          |
| `data.reference` | String    | Transaction reference. This reference can be used to query the transaction                                      |

<br />

## Sample Webhook Notification Payloads

```json Single Payout
/*
* Applicable Events: "transfer.success", "transfer.failed"
*/
{
  "event": "transfer.success",
  "data": {
    "fee": 15,
    "amount": 150.99,
    "status": "success",
    "currency": "NGN",
    "reference": "Z78EYMAUBQ5"
  }
}
```
```json Bulk Payout
/*
* Applicable Events: "transfer.success", "transfer.failed"
*/
{
  "event": "transfer.success",
  "data": {
    "fee": 15,
    "amount": 150.00,
    "status": "success",
    "currency": "NGN",
    "reference": "Z78EYMAUBQ5",
    "batch_reference": "batch-payment-20230105"
  }
}
```
```json Pay-in (NG Virtual Bank Account)
{
  "event": "charge.success",
  "data": {
    "fee": 150,
    "amount": 245000,
    "status": "success",
    "currency": "NGN",
    "reference": "KPY-PAY-4uore940",
    "transaction_date": "2023-01-10 10:00:04",
    "payment_reference": "KPY-PAY-4uore940",
    "virtual_bank_account_details": {
      "payer_bank_account": {
        "bank_name": "Test Bank",
        "account_name": "Jane Pearson",
        "account_number": "0000000000"
      },
      "virtual_bank_account": {
        "bank_name": "Wema Bank",
        "permanent": true,
        "account_name": "Fixed Account - Merchant A",
        "account_number": "0000000000",
        "account_reference": "91efc933-772c-4725-bc62-eioeioeioew"
      }
    }
  }
}
```
```json Pay-in (Cards, Bank Transfer, Mobile Money)
/*
* Applicable Events: "charge.success", "charge.failed"
*/
{
  "event": "charge.success",
  "data": {
    "fee": 10,
    "amount": 1000,
    "status": "success",
    "currency": "KES",
    "reference": "merchant-payment-referece-001",
    "payment_method": "mobile_money",
    "payment_reference": "merchant-payment-referece-001"
  }
}
```
```json Refunds
/*
* Applicable Events: "refund.success", "refund.failed" 
*/
{
  "event": "refund.success",
  "data": {
    "amount": 100.00,
    "status": "success",
    "currency": "NGN",
    "reference": "RFD-API-001",
    "payment_reference": "merchant-payment-referece-001",
    "refund_date": "2023-01-10T10:00:04.000Z",
    "completion_date": "2023-01-10T11:30:00.000Z"
  }
}
```

<br />

## Verifying a Webhook Request

It is important to verify that requests are coming from Korapay to avoid delivering value based on a counterfeit request. To verify our requests, you need to validate the signature assigned to the request.<br />Valid requests are sent with a header **x-korapay-signature** which is essentially an HMAC SHA256 signature of ONLY the **data** object in response payload signed using your secret key.

```javascript
const crypto = require(“crypto”);
const secretKey = sk_live_******

router.post(‘/your_webhook_url’, (req, res, next) => {
  const hash = crypto.createHmac('sha256', secretKey).update(JSON.stringify(req.body.data)).digest('hex');

   If (hash === req.headers[‘x-korapay-signature’]) {
     // Continue with the request functionality
   } else {
     // Don’t do anything, the request is not from us.
   }
});
```
```java
 
import javax.crypto.Mac; 

public class WebhookVerification {
 private static readonly char[] HEX_ARRAY = "0123456789abcdef".ToCharArray();

 private static string bytesToHex(byte[] bytes) {
   char[] hexChars = new char[bytes.Length * 2];
   for (int j = 0; j < bytes.Length; j++) {
     int v = bytes[j] & 0xFF;
     hexChars[j * 2] = HEX_ARRAY[v >> 4];
     hexChars[j * 2 + 1] = HEX_ARRAY[v & 0x0F];
   }

   return new string (hexChars);
 }

 public static String generateWebhookSignature (String wehbookData, String korapaySecretKey) throws Exception {
   Mac sha256HMAC = Mac.getInstance("HmacSHA256");
   SecretKeySpec secretKey = new SecretKeySpec(korapaySecretKey.getBytes("UTF-8"), "HmacSHA256");
   sha256HMAC.init(secretKey);
    
   return bytesToHex(sha256HMAC.doFinal(wehbookData.getBytes("UTF-8")));
 }
}
```
```php
<?php
  ini_set('serialize_precision','-1');// ensures that the precision for the amount field is maintained for json_encode
  if ((strtoupper($_SERVER['REQUEST_METHOD']) != 'POST' ) || !array_key_exists('HTTP_X_KORAPAY_SIGNATURE', $_SERVER)) {
    // invalid request, ignore
    return http_response_code(200);
  }

  $requestBody = json_decode(@file_get_contents("php://input"), JSON_UNESCAPED_SLASHES);
  $webhookSignature = $_SERVER['HTTP_X_KORAPAY_SIGNATURE'];
  $korapaySecretKey = 'sk_live_******';

  If ($webhookSignature !== hash_hmac('sha256', json_encode($requestBody['data']), $korapaySecretKey)) {
    // do nothing, request is invalid
    return http_response_code(200);
  }

  // continue with the request functionality
  
  return http_response_code(200);
?>
```

## Responding to a Webhook Request

It is important to respond to the requests with a `200` status code to acknowledge that you have received the requests. Korapay does not pay attention to any request parameters apart from the request status code.

Please note that if any other response code is received, or there’s a timeout while sending the request, we retry the request periodically within 72 hours after which retries stop.

## Resending a Webhook via the Kora Dashboard

For every transaction, Kora sends a webhook notification to the merchant’s configured webhook URL. If the transaction status is Successful/Failed, the ‘Resend Webhook’ button becomes activated on the dashboard, allowing you to manually trigger the webhook notification again.

### Conditions for Resending Webhooks

For Payouts

* When **channel** is `api` and **status** is `successful` or `failed`.

For Pay-ins

* When **channel** is `api` and **status** is `successful` or `failed`.
* When **channel** is `modal` and **status** is `successful`.

### How to Resend a Webhook Notification on a Transaction

1. On your Kora Dashboard, navigate to the Webhook / Metadata section of the transaction's detail.
2. Locate the webhook notification for the transaction in question.
3. If the status is `Successful`/`Failed`, the **Resend Webhook** button will be displayed in the top-right corner.
4. Click the **Resend Webhook** button to manually trigger a new webhook notification. Be sure that you need to resend the webhook to avoid duplicate transactions on your end.
5. The webhook request will be reattempted and the updated status can be reviewed in the dashboard.

<Image src="https://files.readme.io/9dc817528bfc7b112407c63c7d919ece1b4f6d0a75a6e92ee922f6962fe0d4cc-Screenshot_2025-03-11_at_12.05.23_PM.png" align="center" />

***

## Best Practices

It is recommended to do the following when receiving webhook notifications from us:

* **Keep track of all notifications received**: It’s important to keep track of all notifications you’ve received. When a new notification is received proceed to check that this has not been processed before giving value. A retry of already processed notifications can happen if we do not get a `200` HTTP Status code from your notification URL, or if there was a request time out.
* **Acknowledge receipt of notifications with a 200 HTTP status code**: It’s recommended you immediately acknowledge receipt of the notification by returning a `200` HTTP Status code before proceeding to perform other logics, failure to do so might result in a timeout which would trigger a retry of such notification.