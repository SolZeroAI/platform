# External integrations

The canonical user-flow recipe is
[`tests/external-integrations.e2e.ts`](../../../../tests/external-integrations.e2e.ts).
These cases are tagged `external` (plus per-integration tags). Run them with:

```sh
nub run test:e2e:external -- tests/external-integrations.e2e.ts
# or
nub run test:e2e:all
```

Read the External fixture preflight section in `docs/e2e.md` before claiming coverage.
Missing fixtures fail fast; they do not skip. Use the real Alchemy stack with an
`e2e-*` profile that enables the integrations.

Keep these product facts honest:

- GitHub (`github`): linked identity finds the exact isolated repository named by
  `E2E_GITHUB_REPOSITORY`.
- MCP (`mcpcf`): available server, live invocation, expected fixture output from
  `E2E_MCPCF_*`.
- AI Search (`ai-search`): live source retrieval yields the indexed marker from
  `E2E_AI_SEARCH_*`.
- Slack (`slack`): linked test user produces a session visible in the UI; no external
  Slack message is sent (`E2E_SLACK_USER_ID`).

The user deferred live positive results for these fixtures. Authored cases and preflight
remain available; do not claim green external coverage without a real passing run.
Broader linking/clone/webhook/event paths remain unverified in `docs/e2e.md`.
