---
updatedAt: 2026-06-04T15:28:44.000Z
agentTools:
  projectIndex: https://developers.korapay.com/llms.txt
---

# Payout Utilities

## Get Payment Purposes by Country Code

Retrieves the list of valid payment purposes for a specific country. Payment purposes are required fields for certain payout destinations.

Call this GET endpoint first to fetch the accepted values before submitting a Payout request.

```curl GET
{{baseurl}}/merchant/api/v1/misc/payout-payment-purpose-by-country-code/:countryCode
```

<Callout icon="📘" theme="info">
  Note: This endpoint is conditionally required. Check whether the target country mandates a payment purpose before initiating a payout.
</Callout>

### Supported Countries

| Country       | Country Code | Currency       | Currency Code |
| :------------ | :----------- | :------------- | :------------ |
| United States | US           | US Dollar      | USD           |
| Great Britain | GB           | Pound Sterling | GBP           |

### Integration Notes

* Call this endpoint before submitting a Payout request when the destination country requires a payment purpose.
* Pass the returned code value as the `purpose_of_payment` field in your Payout payload.
* If an unsupported country code is provided, the endpoint will return a `400` error.

### Example Request – United States (USD)

```curl GET
{{baseurl}}/merchant/api/v1/misc/payout-payment-purpose-by-country-code/US
```

### Payment Purposes Response – United States (USD)

This is an example response to the request for payment purposes.

```curl
{
  "status": true,
  "message": "Payment purposes retrieved successfully",
  "data": [
    {
      "countryCode": "US",
      "code": "SALA",     // pass this as purpose_of_payment in your Payout request
      "name": "Salary",
      "description": "Wage or salary payments"
    },
    {
      "countryCode": "US",
      "code": "SERV",
      "name": "Services",
      "description": "Payment for services rendered"
    }
  ]
}
```

## Get Supported Bank Countries by Currency Code

Retrieves the list of countries for which we have supported banks for a specific currency. Use this endpoint to confirm that we have bank support in your target country for the given currency before initiating a Payout request.

```curl GET
{{baseurl}}/merchant/api/v1/misc/payout-countries-by-currency-code/:currencyCode
```

<Callout icon="📘" theme="info">
  Note: This endpoint is conditionally required. Call it to verify that your destination country has supported banks under your target currency before submitting a Payout request.
</Callout>

### Supported Currencies

| Currency       | Currency Code | Example Countries with Supported Banks |
| :------------- | :------------ | :------------------------------------- |
| US Dollar      | USD           | United States                          |
| Pound Sterling | GBP           | Great Britain                          |

### Integration Notes

* The returned countries represent destinations where we have supported banks for the given currency. Use this to confirm bank availability before proceeding with a Payout.
* Call this endpoint before submitting a Payout request to ensure we have bank support in your destination country for the target currency.
* Use the returned `iso2` value as the bank\_country in your Payout payload.
* If an unsupported currency code is provided, the endpoint will return a `400` error.
* Requests without a valid public key will return a `401 Unauthorized` error.

### Example Request – US Dollar (USD)

```curl GET
{{baseurl}}/merchant/api/v1/misc/payout-countries-by-currency-code/USD
```

### Supported Bank Countries Response – USD

This is an example response to the request for supported bank countries

```curl
{
  "status": true,
  "message": "currency countries retrieved successfully",
  "data": [
    {
      "country": "United States",
      "countryCode": "US",     // use as bank_country in your Payout request
      "currencyCode": "USD",
      "metadata": null
    },
    {
      "country": "United Kingdom",
      "countryCode": "GB",
      "currencyCode": "USD",
      "metadata": null
    }
  ]
}
```

<br />