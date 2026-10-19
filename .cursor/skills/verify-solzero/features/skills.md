# Skills

The canonical user-flow recipe is [`tests/skills.e2e.ts`](../../../../tests/skills.e2e.ts).
Run it with:

```sh
nub run test:e2e -- tests/skills.e2e.ts
```

Read `docs/e2e.md` for credentials and current verification status. Use the real Alchemy
stack; do not substitute mocks or a standalone web server.

Keep these product facts honest:

- Administrators create global skills under Admin → Integrations → Skills.
- User Settings → Agents → Skills shows an Enable switch that defaults to the admin
  default.
- Per-user enable override survives reload and is visible via `/skills` API fields
  (`enabled`, `defaultEnabled`, `overridden`).
- Resetting the preference restores the admin default; admin delete removes the disposable
  skill.
