---
updatedAt: 2025-02-28T00:11:22.000Z
agentTools:
  projectIndex: https://developers.korapay.com/llms.txt
---

# API Keys

To enable communication between your application and Korapay, you'll need your API Keys. Kora authenticates every request your application makes with these keys. Generally, every account comes with two sets of API keys - **public** and **secret** API keys for [Test and Live modes](https://developers.korapay.com/docs/test-live-modes).

Your **public keys** are non-sensitive identifiers that can be used on the client-side of your application. By design, public keys cannot modify any part of your account besides initiating transactions for you. Your **secret keys**, on the other hand, are to be kept secret and confidential. They are required for accessing any financial data and can be used to make any API call on your account. Your secret keys should never be shared on any client-side code. Treat them like any other password. And, if for any reason you believe your secret key has been compromised simply reset them by generating new keys. You can generate new API keys from your dashboard.

### Obtaining your API Keys

Your API keys are always available on your dashboard. To find your API keys,

* [Login](https://merchant.korapay.com/auth/login) to your dashboard.
* Navigate to Settings on the side menu.
* Go to the API Configuration tab on the Settings page.
* In the Korapay APIs section, you’d see both your Public and Secret keys, and a button to Generate New API Keys.

> 🚧
>
> The API keys in test mode are different from the API keys in Live mode. So you need to always ensure that you do not misuse the keys when you switch between modes.

### Generating new API Keys

You should always keep your API keys safe and protect your account. However, in the event where your API keys have been compromised, you can easily generate new API keys. Simply click the 'Generate New API Keys' button under the API Configuration tab on the Settings page.

![](https://files.readme.io/3487486-Screenshot_2023-02-13_at_7.15.56_PM.png "Screenshot 2023-02-13 at 7.15.56 PM.png")

Once you generate new API keys, the old keys become void - you can no longer use them to make API calls. Make sure to update your application to use the newly generated keys.