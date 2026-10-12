# OIDC identity

The canonical user-flow recipe is
[`tests/identity.external.e2e.ts`](../../../../tests/identity.external.e2e.ts). Tagged
`external` + `oidc`. Run it with:

```sh
nub run test:e2e:external -- tests/identity.external.e2e.ts
```

Requires `E2E_OIDC_PROVIDER_NAME`, `E2E_OIDC_USERNAME`, and `E2E_OIDC_PASSWORD` for an
ordinary member excluded from configured admin emails/domains. Read External fixture
preflight in `docs/e2e.md`.

Keep these product facts honest:

- `Sign in with <provider>` on Learn More opens the isolated IdP and returns to SolZero.
- The member session has `isAdmin: false`; `/admin/summary` returns `403` and `/admin/agents`
  shows Access Denied.
- Disposable `e2e-admin` / `e2e-peer` accounts are configured administrators and do not
  substitute for ordinary-member OIDC verification.
- This flow is user-deferred; do not claim green coverage without a real passing run.
