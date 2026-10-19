# Accounts / API keys

Canonical recipes:

- [`tests/accounts.e2e.ts`](../../../../tests/accounts.e2e.ts) — create, list, authenticated
  request, revoke; Better Auth 1.7 local `account.id` selector; unlinked GitHub App UI
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
- Better Auth 1.7 account APIs select the local `account.id`. Core e2e has only the
  credential row: `/account-info` and `get-access-token` with that id reach the
  credential provider (not a missing row); the provider-side `accountId` returns
  `ACCOUNT_NOT_FOUND`. Unlink of the last credential account is rejected. The GitHub
  App section stays unlinked because core e2e does not enable that OAuth provider.
  Slack empty-state copy sits below the Accounts fold and is not asserted here.
- Linked GitHub profile load, access-token minting, and the Accounts Unlink control
  require the deferred GitHub fixture (`external-integrations.md`). Do not unlink that
  shared identity; it is the same row repository discovery uses.
