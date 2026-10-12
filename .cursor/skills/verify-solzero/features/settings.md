# Settings

The canonical user-flow recipe is [`tests/settings.e2e.ts`](../../../../tests/settings.e2e.ts).
Run it with:

```sh
nub run test:e2e -- tests/settings.e2e.ts
```

Read `docs/e2e.md` for credentials and current verification status. Use the real Alchemy
stack; do not substitute mocks or a standalone web server.

Keep these product facts honest:

- Settings categories load live headings: AI Providers, Agents, Accounts, Data Controls,
  and Learn More.
- Runtime defaults (Default isolate step call limit) persist after Save and reload.
  Unsaved draft values must survive background provider refreshes when the saved value is
  unchanged.
- Legacy `/settings?category=mcp` deep-links redirect to Agents → MCPs with Search MCPs.
- Global secrets support create, metadata search, and delete through the secret editor.
  Exact key/tag metadata and registered secret inputs are required; cleanup deletes the
  disposable secret.

Personal BYOK provider save/call coverage is deferred under `providers.md` (external).
Browser notification settings are not implemented; do not invent that flow.
