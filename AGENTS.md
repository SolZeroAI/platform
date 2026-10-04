# AGENTS.md

## Voice

Use Simplified Technical English in formal, operational, and other sensible components of the document where you’re establishing specifics.
Use Plain Language in introductory, expository, friendly, and other sensible components of the document where you’re drawing the reader in or keeping them engaged.

## Validation

- Before handing work back, run `nub run typecheck`, `nub run lint`, and `nub run format` from the repo root.
- Treat the task as incomplete until those checks pass, unless you explicitly report why a command could not be run or why a failure is unrelated to your changes.
- During iteration, scoped or package-local checks are fine for speed, but the final handoff should still include the repo-root validation commands above.

## End-to-end testing

- Use tester-army/e2e exclusively. Read `.agents/skills/e2e/SKILL.md` before changing tests.
- Store all executable tests at `tests/**/*.e2e.ts`; helpers belong in `tests/support`.
- Use `agent.act` for semantic goals and exact `expect` assertions immediately after each goal.
- Run the real Alchemy stack from `e2e.config.ts`; use `config/e2e-dev.config.jsonc` and isolated configured accounts. Keep web port 3000 and API port 3100.
- The semantic executor uses Cloudflare Clef through AI Gateway. Never substitute Jev or a text model. Supply `CF_AI_GATEWAY_E2E_TOKEN` securely; process/CI environment overrides local `E2E_ENV_FILE` values.
- `nub run test` runs core flows with Cloudflare credentials. `nub run test:e2e:all` includes external integrations and harnesses; it fails explicitly when required isolated fixtures are missing. Focus one file with `nub run test:e2e tests/settings.e2e.ts`. `test:e2e:live` disables action replay; `test:e2e:cache-strict` detects stale recordings.
- Do not replace app routes or bindings with request interception, module mocks, or a second testing framework. Register passwords and secret fixtures with e2e credentials/secrets.
- Record external-service prerequisites and unverified flows in `docs/e2e.md`. A startup failure or unavailable integration is a blocker, not a passing test. Never print tokens or publish app artifacts externally.

## Release Management

- Use the `manage-solzero-releases` skill for changes that affect users, administrators, or deployment operators.
- Read `.agents/skills/manage-solzero-releases/SKILL.md` before you choose a version change or write a file under `.tegami/`.
- Add a Tegami release entry to the feature pull request. Use the `release:none` label for a change with no observable effect, and explain that choice in the pull request.
- Do not edit `VERSION`, `CHANGELOG.md`, or `.tegami/publish-lock.yaml` on a feature branch. The automated version pull request owns those files.

## Local Development

- Use the default dev commands for app debugging: `nub run dev`, `nub run dev:api`, `nub run dev:web`, or `nub run dev:apps`.
- `nub run dev` runs the Alchemy dev stack for the API and web app, with Cloudflare bindings sourced from the real infra declarations.
- Cloudflare Worker Observability is the pre/prod collection path for logs and traces. Keep route instrumentation in Effect logs/spans and do not add ad hoc local-only debug endpoints.
- Local development writes Effect logs through the configured console logger. Deployed pre/prod Workers export logs and traces through the Cloudflare Observability destinations configured in stage metadata.

## Observability

- Use Effect logs, spans, and request telemetry for server-side observability. Prefer the existing request-scoped logger, `RequestEffectLogger`, or `createApiRequestObserver(...)` for internal/background paths instead of raw `console.*` logging.
- For local debugging, run `nub run dev`, trigger the behavior you are investigating, and inspect the Worker console output before concluding a request emitted no logs. Deployed stages export through Cloudflare Worker Observability destinations configured in `stageMetadata.infra`.
- Add thoughtful, structured context at critical boundaries: infrastructure, auth, transport, runtime orchestration, MCP/tool discovery, workflow execution, and external service calls.
- Error logs should explain where the failure happened and include non-secret context that helps debug it later, such as session id, user id, runtime kind, route branch, tool/source ids, model, request/message ids, and sanitized upstream status/error details.
- Never log bearer tokens, refresh tokens, authorization headers, cookies, or raw custom MCP server definitions. Log names, ids, counts, and boolean capability flags instead.
- Do not add noisy catch-all logs. Log at decision points where context would otherwise be lost across Durable Object, Worker, RPC, MCP, workflow, or external API boundaries.
