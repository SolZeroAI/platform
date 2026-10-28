# Advanced sessions

The canonical user-flow recipe is
[`tests/advanced-sessions.e2e.ts`](../../../../tests/advanced-sessions.e2e.ts). Run it with:

```sh
nub run test:e2e -- tests/advanced-sessions.e2e.ts
```

Read `docs/e2e.md` for credentials and current verification status. Use the real Alchemy
stack; do not substitute mocks or a standalone web server.

Keep these product facts honest:

- Incognito sessions are excluded from the ordinary list and remain reachable by direct
  link.
- Custom MCP configuration and the tools/subagent editor persist exact preferences through
  UI save and reload.
