# AGENTS.md

Instructions for AI coding agents working with this codebase.

## Validation

- Before handing work back, run `nub run typecheck`, `nub run lint`, and `nub run format` from the repo root.
- Treat the task as incomplete until those checks pass, unless you explicitly report why a command could not be run or why a failure is unrelated to your changes.
- During iteration, scoped or package-local checks are fine for speed, but the final handoff should still include the repo-root validation commands above.

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

## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues for `Consensys/c0`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default five-label triage vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Use a single-context domain-doc layout with root `CONTEXT.md` and ADRs under `docs/adr/`. See `docs/agents/domain.md`.

<!-- opensrc:start -->

## Source Code Reference

Source code for dependencies is available in `opensrc/` for deeper understanding of implementation details.

See `opensrc/sources.json` for the list of available packages and their versions.

Use this source code when you need to understand how a package works internally, not just its types/interface.

### Fetching Additional Source Code

To fetch source code for a package or repository you need to understand, run:

```bash
npx opensrc <package>           # npm package (e.g., npx opensrc zod)
npx opensrc pypi:<package>      # Python package (e.g., npx opensrc pypi:requests)
npx opensrc crates:<package>    # Rust crate (e.g., npx opensrc crates:serde)
npx opensrc <owner>/<repo>      # GitHub repo (e.g., npx opensrc vercel/ai)
```

<!-- opensrc:end -->
