# Admin

The canonical user-flow recipe is [`tests/admin.e2e.ts`](../../../../tests/admin.e2e.ts).
Run it with:

```sh
nub run test:e2e -- tests/admin.e2e.ts
```

Read `docs/e2e.md` for credentials and current verification status. Use the real Alchemy
stack; do not substitute mocks or a standalone web server.

Keep these product facts honest:

- Administrator access is confirmed via `/admin/access` (`isAdmin: true`).
- Admin pages load live control-plane UI: Agents search, Workflows search, Integrations
  (AI Providers heading), and AI Search.
- Live authenticated summary endpoints (`/admin/summary`, sessions, workflows, AI
  providers, AI Search, MCPCF) return defined payloads.
- Ordinary-member admin denial is covered under `identity.md` (external OIDC fixture), not
  this core suite.
