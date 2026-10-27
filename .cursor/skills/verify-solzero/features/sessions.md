# Sessions / Agents

The canonical user-flow recipe is [`tests/sessions.e2e.ts`](../../../../tests/sessions.e2e.ts).
Run it with:

```sh
nub run test:e2e -- tests/sessions.e2e.ts
```

Advanced session preferences and delegation live in `advanced-sessions.md`. Read
`docs/e2e.md` for credentials and current verification status.
Use the real Alchemy stack. The e2e stage selects the mock AI Gateway binding, which
answers Workers AI locally. Identity and GitHub stay on the live providers.

Keep these product facts honest:

- Session create, tool PATCH, archive, and unarchive persist through the real Worker.
  Archived titles appear under Settings → Data Controls; Unarchive restores active state.
- Foreign-account session read/tools/delete/websocket-token return `404` with separate
  cookies.
- Isolate prompt execution (`runtime` tag) requires exact `hello` in returned output,
  the assistant card, native clipboard, and a message-scoped final token after reload,
  without tools.
- OpenCode and Codex simple prompts (`harness` tag) require Docker source images.
  Codex asserts exact `hello` in output, the assistant card, and the persisted token
  after reload, without tools.
- Claude Code prompt execution is tagged `external` and `harness` and stays deferred
  until a compatible Anthropic fixture is supplied.
