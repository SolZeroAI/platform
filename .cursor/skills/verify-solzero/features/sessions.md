# Sessions / Agents

The canonical user-flow recipe is [`tests/sessions.e2e.ts`](../../../../tests/sessions.e2e.ts).
Run it with:

```sh
nub run test:e2e -- tests/sessions.e2e.ts
```

Advanced session preferences live in `advanced-sessions.md`. Read
`docs/e2e.md` for credentials and current verification status.
Use the real Alchemy stack; do not substitute mocks or a standalone web server.

Keep these product facts honest:

- Session create, tool PATCH, archive, and unarchive persist through the real Worker.
  Archived titles appear under Settings → Data Controls; Unarchive restores active state.
- Foreign-account session read/tools/delete/websocket-token return `404` with separate
  cookies.
