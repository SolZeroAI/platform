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

## Cursor Cloud specific instructions

This section covers non-obvious startup caveats for the Cloud Agent VM. The toolchain (Node 24.15.0 through nvm, Nub 0.4.11 at `~/.nub/bin`, Docker, and the `pkg-config`/`liblzma-dev` native libraries) is already installed. The update script runs `nub install --frozen-lockfile` on each boot. See `README.md` and `CONTRIBUTING.md` for the standard commands, and `.github/workflows/validate.yml` for the full CI check order.

### Node and Nub

- The VM ships a daemon Node 22 at `/exec-daemon/node` that sits early in `PATH`. A line in `~/.bashrc` prepends the nvm Node 24.15.0 bin so fresh shells resolve the correct version. A non-interactive shell that skips `~/.bashrc` can still pick up the daemon Node, so start Nub commands from a login shell or export the nvm bin first.
- Nub reads `package.json#devEngines.runtime` and runs commands with Node 24.15.0 by itself, so `nub run ...` uses the right Node even when the ambient `node` is 22.

### Docker must be started each boot

- The container integration test and the full dev stack build Cloudflare Containers, so they need a running Docker engine. The daemon is not started automatically.
- Start it once per boot: `sudo dockerd > /tmp/dockerd.log 2>&1 &`. It uses the `fuse-overlayfs` storage driver with the containerd snapshotter disabled (Docker 29 needs that for `fuse-overlayfs`), configured in `/etc/docker/daemon.json`.
- For non-root access, run `sudo chmod 666 /var/run/docker.sock` after the daemon is up.

### The `/.alchemy` build temp root

- The repo is checked out at `/workspace`, a direct child of `/`. Alchemy 2.0.0-beta.67 resolves its container build temp root by walking up from `dirname(process.cwd())`, which lands on `/.alchemy`. The user cannot create that under root-owned `/`.
- Create a writable one before running the container test or the dev stack: `sudo mkdir -p /.alchemy && sudo chown "$(id -u):$(id -g)" /.alchemy`. Without it, `tests/integration/api-stack.test.ts` fails with `EACCES: permission denied, mkdir '/.alchemy'`.

### Running the live app needs real Cloudflare credentials

- `nub run dev`, `nub run dev:api`, and `nub run dev:web` all deploy a Cloudflare-backed Alchemy state store on startup and authenticate to the Cloudflare API right away. With no real credentials they stop with `Unauthorized: Authentication failed (status: 400)`.
- To run the live stack, put a real `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in `config/.env` (copy from `config/.env.example`), and copy `config/.dev.vars.example` to `config/.dev.vars`. The web app then serves at `http://localhost:3000` and the API at `http://localhost:1337`.
- Local tests do not need Cloudflare credentials. `tests/integration/api-stack.test.ts` boots the real API Worker with emulated D1, KV, R2, and Durable Objects through an in-memory state store, so it runs offline once Docker and `/.alchemy` are ready.
