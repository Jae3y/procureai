---
updatedAt: 2025-02-28T00:11:33.000Z
agentTools:
  projectIndex: https://developers.korapay.com/llms.txt
---

# Checkout Redirect

Checkout Redirect lets you securely accept payments without having to embed Kora's payment gateway on your website. It's fast, saves development time and comes with an extra advantage - *the redirect functionality*.

With the Checkout Redirect option, you can access the Kora payment gateway by making a request from your server to our [initialize charge endpoint](https://docs.korapay.com/#f192d2e8-aab2-4f5a-98ef-fa0ed7e2d853). We would return a response that includes a Checkout URL that loads the payment gateway where your customers can make secure payments. After payment is completed the customer is returned to any URL specified by you.

Now, let's walk you through integrating Checkout Redirect. 👊🏼

# 1 - Collect Payment Details

Collecting details from your customer is essential to initializing and tracking the transaction. These details are passed to the initialize charge endpoint.

Please find below the request parameters for the endpoint.

<Table align={["left","left","left"]}>
  <thead>
    <tr>
      <th>
        Parameter
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
        `amount`
      </td>

      <td>
        Integer
      </td>

      <td>
        * \*Required\*\* - The amount to charge the customer.
      </td>
    </tr>

    <tr>
      <td>
        `redirect_url`
      </td>

      <td>
        String
      </td>

      <td>
        * \*Optional\*\* - The URL to redirect your customer when the transaction is complete.
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
        * \*Required\*\* - The currency in which the customer should be charged. For example; NGN, KES, GHS, etc.
      </td>
    </tr>

    <tr>
      <td>
        `reference`
      </td>

      <td>
        String
      </td>

      <td>
        * \*Required\*\* - Your transaction reference. *Must be unique for every transaction*.
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
        * \*Optional\*\* - The webhook URL to be called when the transaction is complete.
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
        * \*Optional\*\* - This is the transaction description.
      </td>
    </tr>

    <tr>
      <td>
        `channels`
      </td>

      <td>
        Array [String]
      </td>

      <td>
        * \*Optional\*\* - Methods of payment eg. Bank Transfer (bank\_transfer), card (card), Pay with Bank (pay\_with\_bank), Mobile money (mobile\_money).  

        If only one payment method is available, the customer cannot change to another payment method.
      </td>
    </tr>

    <tr>
      <td>
        `default_channel`
      </td>

      <td>
        String
      </td>

      <td>
        * \*Optional\*\* - Method of payment that should be active by default. E.g Bank Transfer (bank\_transfer), card (card), Pay with Bank (pay\_with\_bank), Mobile money (mobile\_money). The payment method selection page is skipped on the first load.  

        Note that the default channel must also be specified in the `channels` parameter.
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
        * \*Optional\*\* - It takes a JSON object with a maximum of 5 fields/keys. Empty JSON objects are not allowed.  

        Each field name has a maximum length of 20 characters. Allowed characters: `A-Z`, `a-z`, `0-9`, and `-`.
      </td>
    </tr>

    <tr>
      <td>
        `customer`
      </td>

      <td>

      </td>

      <td>
        * \*Required\*\* - This is the JSON object containing the targeted customer information.
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
        * \*Required\*\* - The email of the customer to be charged.
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
        * \*Optional\*\* - The name of the customer to be charged
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
        * \*Optional\*\* - This will set who bears the fees of the transaction. If it is set to `true`, the merchant will bear the fee, while if it is set to `false`, the customer will bear the fee. By default, it is set to `true`.
      </td>
    </tr>
  </tbody>
</Table>

# 2 - Initialize Transaction

After collecting the necessary payment details for the transaction. Make a POST request to our [initialize charge endpoint](https://docs.korapay.com/#f192d2e8-aab2-4f5a-98ef-fa0ed7e2d853).

```text Endpoint: Initialize Charge
https://api.korapay.com/merchant/api/v1/charges/initialize
```

`Authorization: Bearer {SECRET_KEY} REQUIRED`

This endpoint is protected by the secret key authentication mechanism. So when calling it, append your secret key to the authorization headers.

If the API call is successful, Kora returns the following response:

```json Code: Response
{
   “status” : true,
   “message” : “Charge created successfully” ,
   “data”: {
           “reference”: “{{your transaction reference}}”,
           “checkout_url”: "https://checkout.korapay.com/reference/pay"
     }
}
```

You should then redirect your customer to the Checkout URL provided in the response to enable them complete their payment. Once the payment is complete or in the event of a failure, Korapay will redirect your customer to your specified `redirect_url`. The transaction reference will be appended as a query parameter to your `redirect_url` as well.

`https://website_redirect_url/?reference=YOUR_REFERENCE`

In a situation where no`redirect_url` is passed,  the customer receives visual confirmation on the completion of the payment and is NOT redirected out of the current webpage.

# 3 - Verify the Transaction

When the transaction is completed, Kora will redirect your customer to your specified `redirect_url` and send a webhook notification to the `notification_url` that was passed in the API request body.

Notice that along with redirecting the customer to your `redirect_url`, we append the transaction reference as a query parameter.

`https://website_redirect_url/?reference=YOUR_REFERENCE`

Kora redirects the customer to your `redirect_url` when the transaction is complete, when the checkout is closed, or when the payment session ends abruptly. This allows you to take full control of your customers' payment experience by enabling you to reinitialise a new session if the current payment session ended abruptly. A perfect use case for this could be when your customer’s session mistakenly closes the payment page while waiting for confirmation of a bank transfer. The customer would be redirected to your ‘redirect\_url’, so you can query the transaction status and give visual feedback when the transaction is completed rather than reinitialise another transaction.

It is expected that you retrieve the reference from the URL parameters and call our [verify charge endpoint](https://docs.korapay.com/#8a602daa-6e83-4118-9ff3-ba8c09ab6f48) to get the status of the transaction. **Make sure to always call direct endpoints from your server, and not from the client-side (frontend) of your application.**

> 🚧 Heads up!
>
> It is very important to confirm the status of the transaction before you give value to the customer.

# 4 - Adding an Event Listener (Optional - for better control)

Before we redirect the customer to your redirect URL, the payment gateway exposes events to the browser. To receive those events, you have to attach an event listener to the browser window as shown in the script below. To ensure security and the fidelity of the messages received, it is important that the appropriate Checkout URL gotten from the [initialize endpoint](https://docs.korapay.com/#f192d2e8-aab2-4f5a-98ef-fa0ed7e2d853) is passed as an argument when attaching an event listener to the browser window.

```javascript Event Listener
window.addEventListener(type, handleResponse, checkoutURL);
function handleResponse(event) {
    if (event.origin === checkoutURL) {
        // Handle response
    }
}
// ‘type’ represents the transaction event type and could be one of the following: ‘success’, ‘failed’, ‘pending’, ‘close’.
```

The response `{event.detail}` returned should have the following fields:

| Field            | Data Type | Description                                                      |
| :--------------- | :-------- | :--------------------------------------------------------------- |
| `result`         | string    | Event being triggered. Could be `success`, `failed`, or `close`. |
| `data`           | object    | JSON object containing transaction details                       |
| `data.amount`    | string    | Transaction Amount                                               |
| `data.reference` | string    | Transaction Reference                                            |
| `data.status`    | string    | Transaction Status                                               |

# 5 - Receive confirmation via webhook

When the payment is successful, we make a POST request to your webhook URL (as set up in your dashboard or while initializing the transaction using the key: `notification_url`). This is the format of the response:

```json Webhook Request Payload
{
  "event":  "charge.success" // the notification is only sent for successful charge,
  "data": {
    "reference": "9965128", // the unique transaction reference
    "currency": "NGN",
    "amount": 100000,
    "fee": 1075,
    "status": "success",
    "payment_method": "bank_transfer", // can be bank_transfer, card, pay_with_bank
    "payment_reference": "9965128" // DEPRECATED the unique transaction reference
  }
}
```