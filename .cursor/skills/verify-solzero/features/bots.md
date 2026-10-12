# Bots

The canonical user-flow recipe is [`tests/bots.e2e.ts`](../../../../tests/bots.e2e.ts).
Run it with:

```sh
nub run test:e2e -- tests/bots.e2e.ts
```

Read `docs/e2e.md` for credentials and current verification status. Use the real Alchemy
stack; do not substitute mocks or a standalone web server.

Keep these product facts honest:

- Bot creation from `/bots` opens the detail page with the bot name as a heading.
- Temporary routines can be created and deleted through the UI; no scheduled action is
  allowed to fire in the test.
- Bots have no public delete endpoint. The creation test may leave a dormant disposable bot
  record in the local database after deleting its routine.
