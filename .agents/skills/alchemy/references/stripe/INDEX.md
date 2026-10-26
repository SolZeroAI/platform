# stripe index

5 pages. Sell subscriptions and onboard merchants from a Cloudflare Worker — catalog, Checkout, the Billing Portal, Connect, and webhooks declared next to the code that uses them.

| Page | File | Covers |
| --- | --- | --- |
| Stripe | `_overview.md` | Sell subscriptions and onboard merchants from a Cloudflare Worker — catalog, Checkout, the Billing Portal, Connect, and webhooks declared next to the code that uses them. |
| Setup | `setup.md` | Connect alchemy to Stripe — secret key, profiles, CI, and how Worker bindings get their credentials. |

## guides/

| Page | File | Covers |
| --- | --- | --- |
| Onboard merchants with Connect | `guides/connect.md` | Build a Connect platform on a Cloudflare Worker — create Express accounts, send merchants through hosted onboarding, and learn from account.updated when they can take payments. |
| Sell a subscription | `guides/subscriptions.md` | The full SaaS billing loop on one Cloudflare Worker — hosted Checkout, the Billing Portal, and webhooks that keep an entitlement record your app gates on. |
| React to Stripe events | `guides/webhooks.md` | consumeEvents provisions the webhook endpoint and runs one Effect per delivery. When to use it, which events to listen for, and how to manage the endpoint yourself. |
