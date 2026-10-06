---
updatedAt: 2025-02-28T00:12:59.000Z
agentTools:
  projectIndex: https://developers.korapay.com/llms.txt
---

# Testing Identity on the Sandbox Environment

You can test the Identity service in our easy-to-use sandbox environment before integrating with us. We recommend performing these tests to ensure a seamless integration of the service.

In the sandbox environment, you can simulate the following experiences;

1. KYC Identity verification  (Look-up)
2. KYB Identity verification (Look-up)
3. Testing webhook events on sandbox

To test the Identity service on the sandbox environment, you need to switch your Kora dashboard to [test mode](https://developers.korapay.com/docs/test-live-modes) and access your test secret key in the API configurations section. Use the test secret key for authorization instead of your live secret key.

> 💡
>
> Verification in the sandbox environment can only be done with [test data](https://developers.korapay.com/docs/testing-your-integration#testing-identity).