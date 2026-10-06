# Sessions / Agents

The canonical user-flow recipe is [`tests/sessions.e2e.ts`](../../../../tests/sessions.e2e.ts).
Run it with:

```sh
nub run test:e2e -- tests/sessions.e2e.ts
```

Multi-tool OpenCode/Codex follow-up coverage lives in `harness-tools.md`. Advanced session
preferences, attachment cancel, and delegation live in `advanced-sessions.md`. Read
`docs/e2e.md` for credentials, Docker harness requirements, and current verification status.
Use the real Alchemy stack; do not substitute mocks or a standalone web server.

Keep these product facts honest:

- Session create, tool PATCH, archive, and unarchive persist through the real Worker.
  Archived titles appear under Settings → Data Controls; Unarchive restores active state.
- Foreign-account session read/tools/delete/websocket-token return `404` with separate
  cookies.
- Isolate prompt execution (`runtime` tag) requires exact Workers AI `hello` in returned
  output, the assistant card, native clipboard, and a message-scoped final token after
  reload, without tools.
- OpenCode and Codex simple prompts (`harness` tag) require Docker source images and the
  configured application model. Codex asserts exact `hello` in output, card, and persisted
  token after reload, without tools.
- Claude Code prompt execution is tagged `external` + `harness` and remains deferred until
  a compatible Anthropic fixture is supplied.

Do not claim Claude Code or other deferred harness variants as green coverage.
