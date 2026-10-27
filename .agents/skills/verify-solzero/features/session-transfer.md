# Session transfer

The canonical user-flow recipe is
[`tests/session-transfer.e2e.ts`](../../../../tests/session-transfer.e2e.ts). Run it with:

```sh
nub run test:e2e -- tests/session-transfer.e2e.ts
```

Read `docs/e2e.md` for credentials and current verification status. Use the real Alchemy
stack; do not substitute mocks or a standalone web server.

Keep these product facts honest:

- Authentication transfer redemption uses a real one-time token/cookie, exact redirect, and
  rejects repeat redemption.
- Session deep links are covered; “Share Session” is the conditional Okta authentication
  transfer UI, not chat sharing.
- Conditional Okta transfer UI variants beyond the core redemption path remain unverified
  in `docs/e2e.md`.
