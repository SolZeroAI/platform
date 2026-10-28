---
packages:
  "release:solzero": patch
---

## Select end-to-end test models with shared settings

End-to-end checks read the decision model from `E2E_DECISION_MODEL` and the language
model from `E2E_LANGUAGE_MODEL`. CI reads both from SolZeroAI organization Actions
variables. Without them, local runs use Cloudflare Clef and Claude Haiku 5.5 through the
account's default AI Gateway. Third-party models such as Claude Haiku bill through
Cloudflare Unified Billing.
