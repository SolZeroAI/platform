# Workflows

The canonical user-flow recipe is
[`tests/workflows.e2e.ts`](../../../../tests/workflows.e2e.ts). Run it with:

```sh
nub run test:e2e -- tests/workflows.e2e.ts
```

Read `docs/e2e.md` for credentials and current verification status. Use the real Alchemy
stack; do not substitute mocks or a standalone web server.

Keep these product facts honest:

- Workflow save, name edit, YAML export, disable/enable, and archive persist. Exported YAML
  contains the saved (renamed) name.
- Invalid manifests receive live Worker `400` before persistence.
- JS execution with R2 artifact and run deletion (`workflow-runtime` tag) requires a
  completed run, exact artifact marker/events, and the real dynamic Workflow binding.
- Workflow archive follows the public API's soft-deletion behavior.
- AI authoring, approval/resume, external HTTP/email/Slack actions, and schedule/webhook
  triggers remain unverified in `docs/e2e.md`.
