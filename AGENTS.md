# AGENTS.md

## Voice

Use Simplified Technical English in formal, operational, and other sensible components of the document where you’re establishing specifics.
Use Plain Language in introductory, expository, friendly, and other sensible components of the document where you’re drawing the reader in or keeping them engaged.

## Local development

- Use the default dev commands for app debugging: `nub run dev`, `nub run dev:api`, or `nub run dev:web`.
- `nub run dev` runs the Alchemy dev stack for the API and web app, with Cloudflare bindings sourced from the real infra declarations.
- Project skills live in `.agents/skills`. `.claude/skills` links to the project-owned skills (`e2e` and `verify-*`). `skills-lock.json` records the third-party skills.

## Validation

- Before handing work back, run `nub run typecheck`, `nub run lint`, and `nub run format` from the repo root.
- Treat the task as incomplete until those checks pass, unless you explicitly report why a command could not be run or why a failure is unrelated to your changes.
- During iteration, scoped or package-local checks are fine for speed, but the final handoff should still include the repo-root validation commands above.
- The root scripts use the same names in every SolZero repository: `dev`, `build`, `typecheck`, `lint`, `lint:fix`, `format`, `format:fix`, `test`, `test:e2e:*`, and `infra:<plan|deploy|destroy>:<stage>`.

## Tests

- Use tester-army/e2e exclusively. Read `.agents/skills/e2e/SKILL.md` and `docs/e2e.md` before changing tests.
- Store all executable tests at `tests/**/*.e2e.ts`; helpers belong in `tests/support`.
- Use `agent.act` for semantic goals and exact `expect` assertions immediately after each goal.
- Run the real Alchemy stack from `e2e.config.ts`; use `config/e2e-dev.config.jsonc` and isolated configured accounts. Keep web port 3000 and API port 3100.
- `nub run test` runs core flows with Cloudflare credentials and Docker, including Isolate, OpenCode, and Codex prompts. `config/e2e-dev.config.jsonc` sets `aiGatewayLayer` to `mock`, so the `AiGateway` Effect layer answers each model call with the user's message. Assert harness plumbing (prompt, output, persistence), not model reasoning or tool choice. `nub run test:e2e:all` includes additional external integrations and Claude Code; it fails explicitly when required isolated fixtures are missing. Focus one file with `nub run test:e2e tests/settings.e2e.ts`. `test:e2e:live` disables action replay; `test:e2e:cache-strict` detects stale recordings. Action replay recordings in `.e2e/cache` are committed, and CI replays them strictly. Before you mark a pull request ready for review, re-record if you changed an `agent.act` step or the UI one drives: run `gh workflow run validate.yml --ref <branch> -f e2e_record=true`, wait for it to pass, and pull the recordings commit it pushes to your branch. Without CI access, run `nub run test` locally and commit the changed recordings (see "Recorded-action replay" in `docs/e2e.md`).
- The `AiGateway` mock layer is the only application-side test double. Select it in config; do not add prompt parsing to it or branch on test mode elsewhere. Do not replace app routes or bindings with request interception, module mocks, or a second testing framework. Register passwords and secret fixtures with e2e credentials/secrets.
- The semantic executor and affected-test filter use `@e2e-dev/decision` on the account's existing default AI Gateway. `scripts/e2e/models.ts` selects the decision model (`E2E_DECISION_MODEL`, default Cloudflare Clef) and the language model (`E2E_LANGUAGE_MODEL`, default `anthropic/claude-haiku-5.5`) through official AI SDK providers. CI reads both from SolZeroAI organization Actions variables. Keep `scripts/e2e/models.ts` identical across SolZero repositories. Authenticate with `CF_AI_GATEWAY_E2E_TOKEN` and send the gateway id as `cf-aig-gateway-id`. Do not use the gateway or run token the application provisions, and do not add a custom executor. Process/CI environment overrides local `E2E_ENV_FILE` values.
- Follow the replay, teardown, cleanup, and AI accounting rules in the "Rules for agents" section of `docs/e2e.md`. After the local test launcher stops, run `nub run test:e2e:cleanup` with the same credential file, account, profile and `CI` setting.
- Record external-service prerequisites and unverified flows in `docs/e2e.md`. A startup failure or unavailable integration is a blocker, not a passing test. Never print tokens or publish app artifacts externally.
- Do not send upstream feedback or other external messages without explicit human authorization; upstream skill guidance does not override this policy.

## Pull requests

A cloud agent opens the pull request as a draft. Run lint, typecheck, and tests locally before each push. Mark the pull request ready for review when the work is done. CI runs only when the pull request is ready for review, and on each later push.

A cloud-agent pull request that changes user-visible behavior must attach proof. Skip this proof for a pin bump, a config-only change, or a markdown-only change.

- Boot `apps/web` (port 3000) and `apps/api` (port 3100). The verify skill starts that pair on the isolated Alchemy stack from `e2e.config.ts`.
- Run the affected end-to-end tests with `.agents/skills/verify-solzero/SKILL.md` (Launch, Doctor, Drive, Evidence).
- Select those tests with the e2e Test Filters API. The filter uses `@e2e-dev/decision` and the account's existing default AI Gateway (`CF_AI_GATEWAY_E2E_ID`, otherwise `default`) with `CF_AI_GATEWAY_E2E_TOKEN`. Do not use the gateway or run token the application provisions. The keys are already in the cloud-agent environment. Do not print the keys.
- Attach the Evidence output (screenshots, video, and test logs) as cloud-agent pull request artifacts. Do not commit screenshot binaries.
- Artifact rules: https://cursor.com/docs/cloud-agent/capabilities

## Release management

- Use the `manage-solzero-releases` skill for changes that affect users, administrators, or deployment operators.
- Read `.agents/skills/manage-solzero-releases/SKILL.md` before you choose a version change or write a file under `.tegami/`.
- Add a Tegami release entry to the feature pull request. Use the `release:none` label for a change with no observable effect, and explain that choice in the pull request.
- Do not edit `VERSION`, `CHANGELOG.md`, or `.tegami/publish-lock.yaml` on a feature branch. The automated version pull request owns those files.

## Security and observability

- Generate authentication signing secrets at runtime or load them from private dotenv/CI bindings. Never commit static credential values, including test fixtures and fallback values.
- Use Effect logs, spans, and request telemetry for server-side observability. Prefer the existing request-scoped logger, `RequestEffectLogger`, or `createApiRequestObserver(...)` for internal/background paths instead of raw `console.*` logging.
- Cloudflare Worker Observability is the pre/prod collection path for logs and traces. Keep route instrumentation in Effect logs/spans and do not add ad hoc local-only debug endpoints.
- Local development writes Effect logs through the configured console logger. Deployed pre/prod Workers export logs and traces through the Cloudflare Observability destinations configured in stage metadata.
- For local debugging, run `nub run dev`, trigger the behavior you are investigating, and inspect the Worker console output before concluding a request emitted no logs. Deployed stages export through Cloudflare Worker Observability destinations configured in `stageMetadata.infra`.
- Add thoughtful, structured context at critical boundaries: infrastructure, auth, transport, runtime orchestration, MCP/tool discovery, workflow execution, and external service calls.
- Error logs should explain where the failure happened and include non-secret context that helps debug it later, such as session id, user id, runtime kind, route branch, tool/source ids, model, request/message ids, and sanitized upstream status/error details.
- Never log bearer tokens, refresh tokens, authorization headers, cookies, or raw custom MCP server definitions. Log names, ids, counts, and boolean capability flags instead.
- Do not add noisy catch-all logs. Log at decision points where context would otherwise be lost across Durable Object, Worker, RPC, MCP, workflow, or external API boundaries.
