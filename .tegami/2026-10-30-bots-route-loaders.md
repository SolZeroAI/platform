---
packages:
  "release:solzero": patch
---

## Load bot pages before they open

The bots list and bot detail pages load their data while the page opens, and start loading when you point at a bot link. A failed load shows the server's message with a Retry button. After you sign in, every open page loads its data again for your account.
