# Auth

The canonical user-flow recipe is [`tests/auth.e2e.ts`](../../../../tests/auth.e2e.ts).
Authentication setup (real sign-in cookies for suites that declare `{ session: "admin" }`)
lives in [`tests/auth.setup.e2e.ts`](../../../../tests/auth.setup.e2e.ts). Run the auth
suite with:

```sh
nub run test:e2e -- tests/auth.e2e.ts
```

Read `docs/e2e.md` for credentials, the isolated `e2e-admin` / `e2e-peer` accounts, and
current verification status. Use the real Alchemy stack; do not substitute mocks or a
standalone web server. The runner owns startup, teardown, and artifacts under `.e2e/`.

Keep these product facts honest:

- Anonymous callers see the credential form (`Sign In`, Email, Password) on protected
  routes such as `/`, `/settings`, `/workflows`, and `/bots`.
- Credential sign-in with the disposable administrator opens the requested authenticated
  page (for example Settings runtimes).
- Protected API groups (`/sessions`, `/secrets`, `/skills`, `/bots`, `/workflows`,
  `/providers`, `/admin/summary`, `/repos`) return `401` without a session.
- Sign-out from the Account menu returns the Sign In form; reload keeps the caller
  anonymous.
- Auth setup uses the real sign-in endpoint and installs returned cookies. It is setup
  infrastructure, not a standalone user-facing area.

OIDC ordinary-member sign-in and admin denial live under `identity.md` (external fixture).
Additional social-provider variants remain unverified in `docs/e2e.md`.
