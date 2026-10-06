# Harness tools

The canonical user-flow recipe is
[`tests/harness-tools.e2e.ts`](../../../../tests/harness-tools.e2e.ts). Run it with:

```sh
nub run test:e2e -- tests/harness-tools.e2e.ts
```

Tagged `harness-tools`. Requires Docker and the configured Cloudflare GPT-OSS application
model for source-image OpenCode and Codex. Read `docs/e2e.md` for provider budgets,
reasoning-effort fixtures, and recorded provider failure history. Use the real Alchemy
stack; do not substitute mocks or a standalone web server.

Keep these product facts honest:

- OpenCode and Codex must perform two distinct actual shell calls with successful
  correlated results, file readback in the same session, and persisted token events for
  both turns.
- Assertions use actual commands and byte-exact stdout, not model summary spelling.
- Follow-up requests may omit `sessionKind`; the session run API inherits the existing
  kind.
- Native provider output-limit failures remain recorded historical evidence; do not hide
  them with retries or fabricated tool calls.
