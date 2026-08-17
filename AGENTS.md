# AGENTS.md

Instructions for AI coding agents working with this codebase.

All responses and output content must follow these writing style rules: write in ASD-STE100 style English that's easy to read. No antithesis. No corrective negation. No paragraph pinning. No parataxis. No summary beats. No rhetorical crutches. No negative parallelisms. No negative anaphoras. No contrasting pairs. No rule of three. No em dashes. No throat-clearing openers. No landing sentences. No setup/payoff constructions. No parallel sentence structures within a paragraph. Vary sentence length unpredictably. No stacked noun phrases. No filler intensifiers (genuinely, really, truly, actually). No corporate-register verbs (leverage, underscore, reflect). No nominalization. No hedging qualifiers. Write for the spoken voice. No performed enthusiasm.

## Validation

- Before handing work back, run `nub run typecheck`, `nub run lint`, and `nub run format` from the repo root.
- Treat the task as incomplete until those checks pass, unless you explicitly report why a command could not be run or why a failure is unrelated to your changes.
- During iteration, scoped or package-local checks are fine for speed, but the final handoff should still include the repo-root validation commands above.

## Test Placement

- Store tests only in dedicated `test`, `tests`, or `__tests__` directories.
- Put web tests under `apps/web/tests`. Put cross-package suites under the matching root `tests/<suite>` directory.
- The `s0-lint/no-colocated-tests` rule rejects `*.test.*` and `*.spec.*` files that sit beside source code.

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
