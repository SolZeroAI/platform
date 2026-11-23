# stripe index

7 pages. Sell subscriptions and onboard merchants from a Cloudflare Worker — catalog, Checkout, the Billing Portal, Connect, and webhooks declared next to the code that uses them.

| Page | File | Covers |
| --- | --- | --- |
| Stripe | `_overview.md` | Sell subscriptions and onboard merchants from a Cloudflare Worker — catalog, Checkout, the Billing Portal, Connect, and webhooks declared next to the code that uses them. |
| Accounts and API keys | `accounts-and-keys.md` | How a Stripe account and its test mode keep data apart, how secret and restricted keys differ, and which key Alchemy deploys with and which your runtimes hold. |
| Setup | `setup.md` | Connect alchemy to Stripe — secret key, profiles, CI, and how Worker bindings get their credentials. |
| What is Stripe? | `what-is-stripe.md` | The concepts behind Stripe — accounts and test mode, API keys, products and prices, customers, Checkout, subscriptions, the Billing Portal, webhooks and Connect — and how @alchemy.run/stripe models each of them. |

## guides/

| Page | File | Covers |
| --- | --- | --- |
| Onboard merchants with Connect | `guides/connect.md` | Build a Connect platform on a Cloudflare Worker — create Express accounts, send merchants through hosted onboarding, and learn from account.updated when they can take payments. |
| Sell a subscription | `guides/subscriptions.md` | The full SaaS billing loop on one Cloudflare Worker — hosted Checkout, the Billing Portal, and webhooks that keep an entitlement record your app gates on. |
| React to Stripe events | `guides/webhooks.md` | consumeEvents provisions the webhook endpoint and runs one Effect per delivery. When to use it, which events to listen for, and how to manage the endpoint yourself. |
