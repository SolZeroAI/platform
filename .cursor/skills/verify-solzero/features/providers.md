# BYOK / personal providers

The canonical user-flow recipe is
[`tests/provider.external.e2e.ts`](../../../../tests/provider.external.e2e.ts). Tagged
`external` + `byok`. Run it with:

```sh
nub run test:e2e:external -- tests/provider.external.e2e.ts
```

Requires `E2E_BYOK_BASE_URL`, `E2E_BYOK_MODEL`, and `E2E_BYOK_API_KEY`. Read External
fixture preflight in `docs/e2e.md`. Use the real Alchemy stack; never reuse the Clef
decision token as an application provider.

Keep these product facts honest:

- Personal provider save stores encrypted credential metadata and shows the provider in
  settings.
- A real isolate model call must return actual output; settings are restored afterward.
- LiteLLM administrative model sync and other catalog paths remain unverified.
- This flow is user-deferred; collection alone is not passing coverage.
