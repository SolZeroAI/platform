# Accounts / API keys

Canonical recipes:

- [`tests/accounts.e2e.ts`](../../../../tests/accounts.e2e.ts) — create, list, authenticated
  request, revoke
- [`tests/api-contract.e2e.ts`](../../../../tests/api-contract.e2e.ts) — exported schema and
  OpenAPI contract against live Worker responses

Run focused suites with:

```sh
nub run test:e2e -- tests/accounts.e2e.ts
nub run test:e2e -- tests/api-contract.e2e.ts
```

Read `docs/e2e.md` for credentials and current verification status. Use the real Alchemy
stack; do not substitute mocks or a standalone web server.

Keep these product facts honest:

- API keys appear under Settings → Accounts (`/settings?category=api-access`) by label.
- A minted key authorizes `/sessions` with `200` before revoke and `401` after.
- Revoked labels disappear after reload.
- Exported Effect schemas (`CreatedApiKeyResponse`, `ApiKeysResponse`, `SessionResponse`)
  decode actual Worker responses. OpenAPI documents the live contract (no obsolete
  `apiKey` / nested `session` wrappers; run body does not require `sessionKind`).
- The current UI has no Copy button on API keys; native clipboard proof uses the runtime
  response Copy markdown control in session flows.
