# End-to-end testing

SolZero uses [tester-army/e2e](https://github.com/tester-army/e2e) as its only test runner.
Tests exercise the real Alchemy development stack, Cloudflare Worker routes, D1, Durable
Objects, KV, R2, and the web application. The stack uses the isolated `e2e` configuration
profile with the existing `dev` stage, web port 3000, and API port 3100. Stop other stacks
on these ports before running the suite. Existing applications are never reused.

## Same-origin API routing proof

`nub run test:config` includes local workerd service-binding transport checks without cloud
allocation. These checks cover raw bodies and credential headers, redirects, multiple cookies,
an open SSE response and WebSocket round-trips. They do not validate application authentication
or external OAuth providers against the transport fixture.

The full application profile's sign-in, public health/OpenAPI and API-key checks use
`http://localhost:3000/api`. Full execution
of this routing revision remains pending approval for isolated Cloudflare resources and Docker;
earlier green runs do not prove this revision. Deployed path-route precedence, live OAuth,
signed external webhooks and provider/observability smoke checks remain cutover gates. A stacked
PR whose base is not `master` does not trigger the master-only Validate workflow automatically.

## Run locally

`nub run test:config` runs account-free configuration and offline migration contracts in the same runner,
with owned SQLite, PostgreSQL-wire/PGLite and workerd KV/R2/Durable Object fixtures. It checks bounded
copying, seed/ID preservation, transactional rollback, secret-safe reports and independent state digests.
It does not prove old production object-schema compatibility, PlanetScale connectivity, cross-account
access, callbacks, rotation or live cutover. Those require the [migration gates](migration.md).

Start Docker before the core suite. The launcher fails with an actionable message if its
daemon is unavailable.

```sh
nub install --frozen-lockfile
nub run test:e2e:install
E2E_ENV_FILE=/path/to/private.env nub run test
nub run test:e2e tests/settings.e2e.ts
nub run test:e2e:live tests/skills.e2e.ts
nub run test:e2e:cache-strict
nub run test:e2e:all
nub run test:e2e:external
nub run test:e2e:cleanup
```

The launcher creates missing `config/.env` and `config/.dev.vars` files with mode 0600,
allowing a fresh CI checkout to start the normal infra command. Node watch requires even
its optional environment-file path to exist. The comment-only files supply no deployment
secrets; real credentials still come from the environment.

After stopping the local test stack, run `test:e2e:cleanup` with the same credential file
and profile. It validates the run's local Alchemy state, then destroys that state and
removes the run directory, labelled containers, and images. It refuses an unexpected
remote resource. `config/e2e-dev.config.jsonc` sets `aiGatewayLayer` to `mock`. The `AiGateway` Effect layer (`packages/api/src/server/effect/services/ai-gateway.ts`) then answers Workers AI run requests from Isolate and container runtimes with the last user message. Infra provisions no account AI Gateway, secrets store, or run token for that stage. `aiProviders.cloudflareAiGateway.enabled` stays true so the catalog still has models. Provider-native gateway routes (OpenAI, Anthropic) return 501 under the mock, so Claude Code and BYOK gateway flows need a live stage.
Cleanup does not call the Cloudflare API. The replay cache remains available. Stopping dev alone does not remove the run directory.

The environment loader reads an explicitly selected `E2E_ENV_FILE`, then this repository's
`config/.env` and `config/.dev.vars`. Values already supplied by the shell or CI win.
It never prints values. The shared local gateway credentials can be selected with
`E2E_ENV_FILE=/Users/jbeckman/projects/personal/alchemy-new/config/.env` on the maintainer's
machine; this path is optional and is never assumed in CI.

Supply `CLOUDFLARE_ACCOUNT_ID` and `CF_AI_GATEWAY_E2E_TOKEN`. The launcher and the Validate
e2e job do not read `CLOUDFLARE_API_TOKEN`. `alchemy dev` keeps D1, KV, R2, and Durable
Objects in the run directory. The application child does not receive the e2e token.
The semantic model does not read the deploy token, and it does not
read the gateway or run token the application provisions for a stage or a run.
The suite does not read that gateway's logs.
The test filter and the step executor use `@e2e-dev/decision`: `decisionFilter` and
`decisionExecutor`. `scripts/e2e/models.ts` selects both models. It is the same
file in every SolZero repository.

| Setting | Default | Role |
| --- | --- | --- |
| `E2E_DECISION_MODEL` | `@cf/cloudflare/clef` | `agent.act` actions, `agent.assert` verdicts and the affected-test filter |
| `E2E_LANGUAGE_MODEL` | `anthropic/claude-haiku-5.5` | Text: field values, `agent.waitFor` and `agent.extract` |

CI reads both settings from SolZeroAI organization Actions variables, so one
change there moves every repository. The defaults serve local runs and match the
Shared Project DNA page. Set either variable in `E2E_ENV_FILE` to try another
model locally.

- The decision model returns a probability for each option, so it does not
  write JSON that can fail to parse. Cloudflare Clef speaks the TypeSafe System
  One protocol, so the official `@ai-sdk/typesafe-ai` provider maps the
  questions and answers. Its `fetch` option sends the request to
  `/accounts/<account>/ai/run/<model>` and unwraps the Workers AI
  `{ success, result }` envelope. An `anthropic/` decision model uses
  `@ai-sdk/anthropic` instead; its probabilities are estimates from structured
  output.
- The language model uses the official provider for its API format on the
  Cloudflare REST API at `/accounts/<account>/ai/v1`. `anthropic/` models use
  `@ai-sdk/anthropic` on the Messages route. Other models, such as `@cf/`
  Workers AI models and `openai/` models, use `@ai-sdk/openai` on the chat
  completions route. Third-party models bill through Cloudflare Unified Billing.

Both models use the account's default gateway. The gateway id is
`CF_AI_GATEWAY_E2E_ID`, or `default`, sent as `cf-aig-gateway-id`.
`CF_AI_GATEWAY_E2E_TOKEN` is the `Authorization` bearer. Each request sends
`cf-aig-skip-cache: true`, so the gateway does not cache responses. The gateway
cache stored any 200 body, including an answer the runner rejected. It then
replayed that answer to the retry and to every CI run inside the TTL, so one bad
sample failed the secret editor test on every pull request for an hour. Verified
e2e action replay is the only cache.

Name the control and the finish condition in the `agent.act` goal itself, for
example `Click Save workflow name. Finish when the Save workflow name button is
gone.` Do not add per-step prompt text in the model request.
A failed test runs once more, and the new attempt asks the models again.
`e2e list --changed-since <ref>` and `e2e run --changed-since <ref>` ask the filter which
tests the change can affect. A change to the loaded config or a known lockfile keeps
every test. Exact text values come from `agent.act` params. Use `expect` for
deterministic polling and extraction.

The semantic gateway token is not an application provider credential. It does not
supply OpenAI, Anthropic, or harness subscription keys.

The profile provisions only `e2e-admin@example.test` and `e2e-peer@example.test`.
`E2E_USER_ADMIN_PASSWORD` overrides the disposable administrator password. Otherwise a
random password is generated once in ignored `config/.e2e-password` with mode 0600, so
config loading and worker realms use the same value. Delete that file to rotate it.
These accounts are configured administrators; they are not a substitute for validating
an OIDC ordinary-member deployment. Auth setup uses the real sign-in endpoint and installs
its returned cookies, retaining redacted screenshot support. The separate sign-in test
exercises the visible credential form with e2e secret handles.

`nub run test` and `test:e2e` run core flows, excluding tests tagged `external`.
`test:e2e:all` runs every flow. `test:e2e:external` runs only deferred integrations.
External tests fail with a named missing fixture instead of skipping.

## Recorded-action replay

`nub run test` uses verified action recordings in `.e2e/cache`. A warm `agent.act` can
replay its controls and check its recorded final state without model calls; the immediate
exact assertions still run. Fresh fixture names are marked with e2e `unique()` in action
parameters, so their current values replace recording slots instead of changing the key.
Keep choices that change the action flow, such as light versus dark mode, ordinary values.

Set `E2E_ACTION_CACHE_DIR` to a fresh ignored directory for a cold/warm comparison without
discarding existing recordings. Run normally first to create verified recordings, then
run the same selection with `test:e2e:cache-strict` and the same directory. `test:e2e:live`
disables action recording and replay; it cannot warm the cache. Strict mode still runs a
step live when no entry exists, so verify `step.cache.mode === "self-finalized"` and zero
model calls in the report rather than relying on the command name.

The recordings in `.e2e/cache` are committed to Git, as upstream e2e recommends. CI runs
`test:e2e:cache-strict` against the committed recordings: a stale recording fails the run
with `REPLAY_STALE`, and a step with no recording runs live. A strict run never writes
the cache, so CI cannot change the recordings. The SDK validates each step's instruction,
parameters, agent context, controls and final state itself; the model ids are not part of
the key.

Re-record when a test or the UI it drives changes. Do this before you mark the pull
request ready for review.

1. Run the Validate workflow on your branch with `e2e_record` set: `gh workflow run
   validate.yml --ref <branch> -f e2e_record=true`. The suite runs in read-write mode.
   When it passes, the `Commit recorded action replays` job commits the changed recordings
   to your branch. It pushes with the release App token, so the push starts pull request
   CI. The job does not run on the default branch. Set `e2e_commit=false` to only upload
   the `solzero-e2e-replays-<run>-<attempt>` artifact.
2. Or run `nub run test` (or `nub run test:e2e <file>`) locally. Read-write mode replaces
   stale entries and adds missing ones in `.e2e/cache`. Commit the changed recordings with
   the change that caused them.
3. Pull the branch before you push again. The commit job fails when the branch moved after
   the recorded commit; run `e2e_record` again on the new head. The pull request run
   proves strict replay.

Recordings must not contain secrets. Pass secret values through e2e secret handles, not
action instructions or plain params.

A focused local comparison used a fresh recording directory and ten tests covering bots,
routines, archived sessions, runtime settings, MCP settings, secrets, theme, skills and
workflow editing. The cold run passed in 87.98 seconds with 11 semantic actions and 36
Clef calls. The first warm run passed in 42.80 seconds: ten actions replayed, while
runtime Save still made three calls. Its only visible change was the disabled state,
which the pinned SDK does not record as an end-state anchor. That already-known Save
button now uses an exact locator; value, disabled-state, reload and restoration checks
remain. The final warm run passed in 40.73 seconds with all ten remaining semantic
actions self-finalized, 13 recorded controls replayed and zero model calls. Startup
accounted for 15.86 seconds. This selected-flow proof is not a full core-suite timing or
an application-provider cache proof. Run IDs: cold `01a10b0d-472f-7873-b184-687990a68b20`,
initial warm `01a10b0f-9795-79e9-ac4e-b395e90dd70e`, final warm
`01a10b12-c730-73cf-b00d-ee8c8b6cfe75`.

Live semantic judgments need a model. The current core suite uses `agent.act`, with exact
assertions afterward. AI Gateway response-cache hits are a separate layer and are not
evidence of recorded-action replay.

## AI usage accounting

For a local accounting report, run `nub exec tsx scripts/e2e/ai-report.mjs init` before
the tests and `nub exec tsx scripts/e2e/ai-report.mjs summarize` afterward. These commands
use the pinned Node runtime and do not make model calls.

The summary counts the suite's own decision-model calls. Executor token counts and cost come from
the model records in the e2e report. Decision-filter spend comes from the usage suffix on
that report's filter note, and is left unknown when the suffix is absent. The summary does
not measure application inference, and it does not read AI Gateway logs. Missing
measurements stay unknown. Provider prompt-cache tokens are separate from an AI Gateway
response-cache hit, e2e action replay, and a restored GitHub Actions cache.

CI initializes and summarizes usage around the test run and uploads only sanitized
`summary.json` and `summary.md` from `.e2e/ai-usage`. Raw logs and e2e reports are not
uploaded by that step. The official `@e2e-dev/github` reporter writes e2e results and
SDK-measured model usage to the job summary and updates its pull-request comment. Core and
lifecycle runs use distinct stable keys. `GITHUB_TOKEN` is scoped to the test step and
stripped from application children. There is no custom AI-only PR publisher.
SDK telemetry is disabled with `E2E_TELEMETRY_DISABLED=1`.

The installed CLI refreshed the pristine `.agents/skills/e2e` guidance and the Claude
skill symlink. `.mcp.json` and `.cursor/mcp.json` invoke the installed MCP server through
`nub run --silent test:e2e:mcp`. The MCP command uses the same registered SDK process and verified exit cleanup as test runs; `--silent` keeps Nub headers out of JSON-RPC stdout. Project-specific Node/Nub, gateway, lifecycle and feedback rules live in
`AGENTS.md` and this guide. Upstream feedback or other outgoing messages require explicit
human authorization.

## Coverage inventory

The user-facing flow map lives under
[`.agents/skills/verify-solzero/features/`](../.agents/skills/verify-solzero/features/README.md).
That directory is the single inventory of areas, feature files, and canonical
`tests/**/*.e2e.ts` suites. Every executable test remains under `tests/**/*.e2e.ts`;
shared fetch helpers call live endpoints with the test browser's cookies. Tests never
intercept application requests or mock modules.

Read the feature files for suite paths and how to run a focused file. Keep fixture
preflight, replay, cleanup, and CI guidance in this document; do not duplicate the flow
table here.

### External fixture preflight

The external suites require an isolated deployment with integrations enabled in its
configuration and identities linked to the disposable test account. Set:

- `E2E_CONTAINER_RUNTIME=1` builds the committed agent-container images for local `alchemy dev`. Docker
  must be running. The container
  includes the third-party bootstrap package manager required by AI SDK harness lockfiles;
  repository commands remain Nub (`nub install`, `nub run`, `nub exec`).
  With this flag, the isolated development stack bundles the committed runtime entrypoints
  into ignored `.e2e/containers` contexts and builds their current Dockerfile through Alchemy.
  Initial image builds have a ten-minute startup allowance. Other deployments continue to
  use the pinned published image digests; release publishing is required to ship image changes.
- `E2E_GITHUB_REPOSITORY=owner/repository` for the linked GitHub fixture.
- `E2E_MCPCF_SERVER_ID`, `E2E_MCPCF_PROMPT`, `E2E_MCPCF_EXPECTED_OUTPUT` for a read-only MCP fixture.
- `E2E_AI_SEARCH_SOURCE_ID`, `E2E_AI_SEARCH_QUERY`, `E2E_AI_SEARCH_EXPECTED_OUTPUT` for a seeded index.
- `E2E_SLACK_USER_ID` for a linked isolated Slack identity.
- `E2E_BYOK_BASE_URL`, `E2E_BYOK_MODEL`, `E2E_BYOK_API_KEY` for a read-only personal model fixture.
- `E2E_OIDC_PROVIDER_NAME`, `E2E_OIDC_USERNAME`, `E2E_OIDC_PASSWORD` for an ordinary member
  in the isolated IdP. This username must be excluded from the configured admin emails/domains.

Create the optional isolated external profile:

```sh
cp config/e2e-dev.config.jsonc config/e2e-external-dev.config.jsonc
# Edit the copied profile: keep isolated admin emails and an s0-e2e* appName.
nub run config:check --profile e2e-external
E2E_CONFIG_PROFILE=e2e-external E2E_ENV_FILE=/path/to/private.env nub run test:e2e:all
```

The copied profile is ignored. `E2E_CONFIG_PROFILE` accepts only `e2e` or `e2e-*`; its
configuration must use an `s0-e2e*` deployment name. The loader validates it before Alchemy
starts. Enable the commented integration blocks in this profile:

| Integration | Configuration and private environment | Isolated entities |
| --- | --- | --- |
| GitHub | `integrations.githubApp.enabled`, appId/clientId/slug; `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY`; enable the social GitHub auth provider for linking | Install the app on the fixture repository; link the disposable admin's GitHub account in Accounts |
| Slack | `integrations.slack.enabled`; `SLACK_TOKEN` | Linked Slack test user for `E2E_SLACK_USER_ID` |
| MCPCF | `mcpcf.enabled`, baseUrl, userOauthProviderId; `S0_CONFIG_SECRETS_MCPCF_ADMIN_API_TOKEN` | Reachable registry, read-only tool server, OAuth/token linked identity; choose an ID actually returned by `/sessions/mcpcf/servers` |
| AI Search | `aiSearch.serviceTokenId` referencing `CF_AI_SEARCH_SERVICE_TOKEN_ID` | Seed/index a document, enable the source in Admin > AI Search; choose an ID returned by `/sessions/ai-search/sources` |
| OIDC | `auth.providers.<id>` kind=oidc, issuer/clientId and a chosen clientSecret env reference; signIn/provisionUsers/link capabilities | Isolated IdP clients with localhost callback URLs; distinct admin/member users |
| LiteLLM/BYOK | `aiProviders.litellm.enabled`, baseUrl, `S0_CONFIG_SECRETS_AI_PROVIDERS_LITELLM_API_KEY`, or a personal provider in settings | Compatible reachable model endpoint; per-user provider credential; never reuse the e2e AI Gateway token as an application provider |

Fixture values alone do not enable integrations or link accounts. Missing/disabled
integration state is a reported failure in `test:e2e:all`, not passing coverage.

The launcher exports trusted macOS system roots to an ignored mode-0600 PEM before Alchemy
starts and adds those roots to the runner's default trust set. It never disables certificate
verification or replaces an explicitly supplied CA bundle.

The configured GPT-OSS Responses route rejects the harness tool schema. Its Chat compatibility
route also rejects replayed tool history. The adapter uses the documented
native `/accounts/<account>/ai/run/@cf/openai/gpt-oss-120b` Chat route, requests
buffered JSON with `stream:false`, then emits standard Responses events from the actual result.
The [native Chat model](https://developers.cloudflare.com/workers-ai/models/gpt-oss-120b/)
also supports streaming; this bridge buffers for the harness protocol.
The [Responses compatibility endpoint](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/)
requires `stream:false`. Text, call IDs, arguments,
namespace names, tool results, abort signals, scoped application credentials and gateway headers
are preserved. Output arrives after generation completes. Consecutive calls remain in one
assistant turn. Private provider reasoning is omitted; unsupported replay/protocol semantics
fail explicitly. Absent token budgets use 4096 rather than the native 256-token default;
explicit budgets remain unchanged.

Pinned Codex 0.144.5 omitted the selected reasoning effort for the multi-part Cloudflare model ID.
Its fallback model metadata gates reasoning requests. The pinned harness patch enables that metadata
only for `@cf/openai/gpt-oss-20b` and `@cf/openai/gpt-oss-120b`, with summaries disabled; user-selected
effort then reaches Workers AI. Nub and Docker apply the same patch. This matches the
[tagged client gate](https://github.com/openai/codex/blob/rust-v0.144.5/codex-rs/core/src/client.rs#L762)
and [upstream custom-model report](https://github.com/openai/codex/issues/30697).
The default output budget remains 4096.

The user deferred the extra GitHub, Slack, MCPCF, AI Search, BYOK, and ordinary-member
OIDC fixtures. Their authored cases and fail-fast preflight remain available; no live positive
result is claimed for those cases.

Source inventory still exposes additional external paths that require dedicated fixtures:
Additional social-provider sign-in variants; GitHub linking/clone/branch/write/webhooks;
Slack linking/events/command delivery; MCP registry sync/OAuth and custom local/remote execution;
AI Search indexing; LiteLLM administrative model sync; workflow AI authoring, approval/resume, external
HTTP/email/Slack actions and schedule/webhook triggers; conditional Okta transfer UI. Authentication transfer API redemption is covered in core. These are not
claimed complete by the authored integration cases. The app currently exposes attachment
metadata submission through its HTTP API, but has no browser upload flow or attachment field
in message-list responses. Browser notifications have no implemented settings flow. Session
deep links are covered; “Share Session” is the conditional Okta authentication transfer UI,
not chat sharing. Do not invent missing product features to satisfy a flow name.

Bots have no public delete endpoint. The creation test leaves a dormant disposable bot
record in the local database, but deletes its routine before its first execution. Workflow
archive follows the public API's soft-deletion behavior. Session/skill/secret/key fixtures
are deleted in cleanup; all mutations are limited to the isolated profile.

## CI and artifacts

`Validate` runs static checks and discovers all e2e tests without secrets. Its dedicated
Cloudflare end-to-end job runs `nub run test` on trusted pull requests, pushes and manual
runs, including the canonical repository. Fork pull requests cannot access its credentials.
Configure repository secrets `CLOUDFLARE_ACCOUNT_ID` and `CF_AI_GATEWAY_E2E_TOKEN`.
The e2e job does not read `CLOUDFLARE_API_TOKEN`. It boots local `alchemy dev`. The semantic
model uses the account default AI Gateway, with response caching off. The workflow generates and masks a
fresh disposable account password. Do not use production identity or integration secrets
for tests. Preview and production deploy jobs still read `CLOUDFLARE_API_TOKEN` because
Alchemy's Cloudflare CI credentials require it for a real stage deploy or destroy.

Each launcher owns `.e2e/runs/<UUID>/stack`, including Alchemy state, simulator D1/KV/R2/DO data and source-container build contexts. It runs the shipping stack and normal Alchemy destruction from that directory. The e2e stack creates no remote Cloudflare resources, and cleanup refuses state that names one. Local and CI runs have separate scopes. Cleanup never treats a shared name or prefix as ownership.

The default `test:e2e` command wraps the SDK and verifies recovery after exit. Cleanup failures make the command fail even if SDK teardown ignored the app's exit code. The launcher records exact process birth times and descendants, including detached sidecar groups. Both SDK and Alchemy children must publish a durable launch intent and their own PID/birth before importing the real CLI. Unresolved registration, failed process inspection and a same-birth process moving groups retain evidence and block storage removal. Process inspection and signaling use portable POSIX tools; they cannot eliminate every operating-system identity race. Cancellation signals the owned launcher, and recovery stops only birth-matched descendants before deleting storage. Run `nub run test:e2e:cleanup` again with the same credentials, profile and CI scope after an abrupt termination. Completed receipts make repeated recovery a no-op; active launchers and mismatched ownership are refused.

Cleanup verifies owned Docker label absence before removing the run directory. The directory removal also clears every run-owned identity, auth session/API key, session/workspace/history, bot/routine, agent/skill/MCP definition, uploaded attachment, secret and runtime preference. Most tests also delete their entities or restore settings in `finally`; storage teardown recovers interrupted requests and APIs without individual delete endpoints.

`nub run test:e2e:lifecycle` exercises real success/failure recovery: launcher SIGTERM; SIGKILL with local simulator state and no minted account token; killed CLI leader with detached runtime descendants; an intentionally failing SDK suite; outer-command SIGTERM and SIGKILL after creating an authenticated session; a failed process inspector; and a genuine filesystem publication failure before Alchemy loads; and an official MCP open/observe/close session with valid JSON-RPC stdout and verified app teardown. It verifies receipts, state removal and idempotent recovery. These lifecycle fixtures are excluded from the ordinary core catalogue. To run them on the normal hosted validation job, dispatch `gh workflow run validate.yml --ref feat/e2e -f e2e_lifecycle=true`. The boolean defaults to false, so ordinary PR and push validation still runs only the core suite; an opt-in dispatch adds lifecycle cases after core. Lifecycle reports use `.e2e/cleanup-proof`; intentional inner failures use separate private report directories.

Sanitized CI diagnostics retain `cleanup-summary.json` (counts/types/verified status) for seven days. A separate `solzero-cleanup-ownership-<run>-<attempt>` artifact retains only `cleanup-ownership.json` (repository/run/account hash/profile and exact run-owned resource metadata) for 30 days and uploads even on cancellation. Private state, credentials, logs and journals are never uploaded. Before new allocations, CI examines up to 10,000 repository artifact records and restores pending ownership from completed same-repository Validate attempts, including earlier attempts of the current run. It verifies original producer metadata and byte-equivalent pending rows in immutable dedicated archives. A newer empty or completed inventory does not discard older pending evidence; recovery verifies absence again. Active producers are preserved. Unavailable, conflicting or malformed claimed ownership evidence blocks recovery. Explicit manual recovery can also use a historical diagnostic archive containing the exact ownership file: `CI=1 nub exec tsx scripts/e2e/cleanup.ts /path/to/cleanup-ownership.json`, with the same isolated profile/account and an Actions-read token. Evidence beyond the retention and inventory bounds requires operator review; it is never replaced by a prefix sweep.

The shared base container images/build cache, action replay cache, sanitized reports/receipts and trust-root PEM remain intentionally reusable. Operator dotenv files and the ignored administrator password fixture are retained; they are inputs, not deployed entities. Legacy shared `packages/infra/.alchemy/local` data can contain unrelated dev state and is not swept. External cases read pre-existing GitHub/Slack/MCP/AI Search/provider/identity fixtures and remove their local sessions/settings. They do not create provider accounts, repositories, Slack channels or search indexes. External MCP instructions must be read-only; destructive MCP actions and external identity-provider session revocation require provider-specific fixtures and remain unverified in the deferred scope.

Preview deployment rechecks the current same-repository PR and exact head immediately before creating infrastructure. Cleanup accepts only canonical `pre-<positive-number>` for a currently closed same-repository PR. It restores safe ownership receipts, captures exact Worker-bound gateway/token and DO/container IDs, runs normal Alchemy destroy, and verifies Workers, D1, KV, R2, workflow/AI Search namespaces and captured runtime/gateway/token absence. Asynchronous container removal is polled for up to two minutes. Ownership artifacts survive cleanup failure for retry; cleanup comments require verified success. Shared Secrets Store/default gateway and open PR previews are preserved. Nonempty remote preview deletion and optional BYOK provider-key teardown have not been exercised by this local cleanup proof; do not infer those results from an empty inventory.

Raw browser/network trace ZIPs are disabled because the published SDK cannot register
newly minted API keys or session cookies for dynamic redaction. Keep SDK-redacted
screenshots, screen trees and reports; never send minted credentials to the model.
Sensitive input fixtures must be registered before execution, and cleanup must leave
credential displays before failure capture.

The pinned runner patch quotes the first and last twenty startup log lines through
the SDK's existing environment-secret redactor. Reads remain bounded to eight KiB;
raw stack logs are local diagnostics and are never uploaded by CI. This preserves
the original Alchemy process lifecycle while exposing errors before a final watch
process failure.

The workflow verifies Docker, builds the current harness source images through local
`alchemy dev`, installs Chromium separately, runs the core suite with strict replay of
the committed `.e2e/cache` recordings, and uploads reports and failure artifacts. Other
`.e2e/` output is ignored locally. Chromium receives native clipboard read/write permissions through the small
pinned web-engine patch in `patches/`; clipboard contents are never simulated. API keys
have no Copy button in the current UI. Replay recordings are checked into Git. `test:e2e:live`
forces fresh model decisions; `test:e2e:cache-strict` fails on stale recordings. Read
`.e2e/report.json`, `.e2e/summary.md`, failure pages and the ignored stack log to diagnose
failures. Treat unsupported runtime services and missing credentials as explicit blockers;
do not convert failures into skips or claim green coverage from collection alone.

## Migration and verification

The migration removes 101 legacy test files (602 declared cases) and the Vitest runner,
Workers pool, and configuration. The new catalogue has 38 cases including two real auth
setup cases: 31 core and seven deferred external fixture cases. Collection is separate from execution.
External cases are authored regression coverage, not claims of completed external-service
verification. The original sign-in route was reproduced with two failing credential flows;
its interactive gate fixes early native GET submission. Real regression runs also exposed
and corrected bot child-route rendering, subagent select layering, D1's 50-byte LIKE search
limit, API schema drift, and stale workflow export names. The initial hosted Validate run at `381334d` passed all 27 then-core cases.
Earlier independent live verification and hosted Validate `37241453073` at `e0c39c6`
each passed 31/31. That commit's strict run passed 30/31.

Full-suite verification at `dc6e3ea` produced these results, with 31 core cases selected and
seven user-deferred external cases excluded:

- Independent live run `01a1092d-7d62-7548-884d-95daef4b75f2`: 30/31 in 261.43 seconds.
- Hosted Validate `37242692025`: 30/31. Static validation and actionlint passed.
- Independent strict run `01a10932-409a-7b67-b9fd-c76d10d2132f`: 31/31 in 196.91 seconds,
  with six action replays, five cache misses, 15 Clef calls and 30,672 tokens; no skips or
  flaky passes. Strict action replay still executes the real application and provider flows.

These earlier outcomes remain historical evidence.

The subsequent full hosted run `37251567618` at `bca93d5` executed zero tests: Cloudflare
rejected creation of another auto-generated AI Gateway at the account's 20-gateway limit.
Repository validation and actionlint passed; this was a startup failure, not 31 test failures.
The lifecycle correction at `5bfd00a` was verified against that real full account. Only the
legacy gateway matched to this repository's local e2e Worker/state/store was removed.
Local creation, deletion and token revocation passed, returning the
account to 19 gateways. CI-mode creation then passed 2/2 selected cases in 37.72 seconds
(`01a109c0-7c77-7878-9a52-62174eba2d44`). A cold-state launch at 20 gateways adopted the
same CI gateway and creation timestamp, then passed 2/2 in 35.83 seconds
(`01a109c1-5c79-703f-884d-a2ca2ebd2d33`). Both reports record clean `5bfd00a`.
Guarded normal Alchemy destruction returned 404 for the gateway and both generated CI
tokens, removed the owned local state, and left the other 19 gateway IDs unchanged.
Wrong-scope and legacy-ID cleanup attempts failed before mutation.

The latest complete [hosted Validate run `37253611994`](https://github.com/SolZeroAI/platform/actions/runs/37253611994)
passed at immutable `44abc320ed626f32612b6d7dbfb4e72563d799b1`: 31 selected, executed and
passed core cases, with zero failures, skips or flaky passes in 173.554 seconds. The report
is `01a109ca-c579-73b0-81b5-8b9880b6ae11` and records a clean checkout; artifact
`11321623668` contains the reports. Repository validation, actionlint and guarded cleanup
also succeeded. Subsequent commits change guidance only; runtime and tests remain the
tested revision.

Independent read-only checks after CI found the dedicated CI gateway returned 404 and the
account held 19 gateways. The complete account token list showed no new active application
token since CI began, and the five older token IDs were unchanged. The CI log records
application-token deletion and 21 successful resource removals. Its exact newly created
token ID was not retained, so no direct GET claim is made for that token. Historical
unconfirmed tokens were preserved. This latest complete core success does not erase the
earlier native-provider failures or verify the seven user-deferred external cases.


Cleanup verification on 2026-10-05 passed the eight real failure/cancellation cases in 268.73 seconds (`01a10b63-f318-7d99-a9d3-9f97063a72bb`), with eight verified receipts, seven revoked run tokens and zero remaining owned containers, proxies or images. After the atomic launch-publication refinement, the outer SIGTERM, outer SIGKILL and publication-fault selection passed 3/3 in 76.58 seconds (`01a10b71-73f8-7f50-ae97-20fe6e399520`). The official MCP client then passed its separate real open/observe/close and registered-runner teardown case in 50.35 seconds (`01a10b80-922e-75b4-999e-92e073b14902`); stdout remained valid JSON-RPC. The nine lifecycle cases were verified across these selections, not in one final combined run. After making the public ownership ledger atomic, the controlled publication fault passed again, 1/1 in 2.10 seconds (`01a10b84-1bdf-7c2f-b53a-bc199d5eaa24`), and the initial pending ownership intent remained intact.

The latest local full core run passed 30/31 in 248.04 seconds (`01a10b68-abcc-7c32-8475-1f74b06ad787`); its runtime-settings case exposed an unchanged-value background refresh resetting an unsaved draft. The primitive-value synchronization fix passed the actual refresh/save/reload/restore regression plus authentication setup, 2/2 in 23.38 seconds (`01a10b7a-340e-7aa2-8631-a531574997e1`). The earlier 31/31 local and hosted results above remain historical; final exact-head CI must establish the latest complete core result.

The final read-only account inventory contained 19 gateways and 16 unrelated tokens, zero active run-owned tokens or pending journals, and HTTP 404 for the latest owned gateway and token. Five historical test tokens were matched to recorded ID hashes, creation times, exact names and account policies, then revoked with HTTP 404 verification. Fourteen historical unlabelled containers and seven proxies were preserved because ownership was unproven. Automatic hosted recovery inspected the canonical repository and found zero retained dedicated ownership archives; cross-host recovery of a nonempty archived run remains unexercised. Preview guards have read-only current-PR proof, but no nonempty remote preview teardown was performed. These are local/read-only proofs, not new hosted CI results.

Hosted validation `37296872909` at `25c3903` passed static checks, actionlint, hosted-recovery initialization and cleanup, but core passed 30/31.

## Rules for agents

These rules moved here from `AGENTS.md`. They apply to every agent that runs or changes the suite.

- Wrap fresh fixture data in e2e `unique(value)` action params so recordings substitute the current value. Keep choices that change the action flow as ordinary params. Prove warm action replay with `self-finalized` steps and zero model calls; API response-cache hits do not prove replay.
- Default test commands automatically verify per-run local Alchemy, Docker, and simulator teardown. The launcher boots `alchemy dev` in the run directory and does not create a Cloudflare AI Gateway or account API token, so it does not read `CLOUDFLARE_API_TOKEN`. `CLOUDFLARE_ACCOUNT_ID` stays because the decision model calls the account's default AI Gateway. The application does not receive the e2e token or gateway id. Keep private run journals until verified absent; never signal a reused PID/group or sweep shared simulator data. Publish durable child launch intent and self-registration before allocation; unresolved publication or failed process inspection must block storage removal. Run `nub run test:e2e:lifecycle` after lifecycle changes; hosted dispatch accepts `e2e_lifecycle=true`.
- After the local test launcher stops, run `nub run test:e2e:cleanup` with the same credential file, account, profile and `CI` setting. Preserve unrelated resources; never bypass ownership guards. CI performs this cleanup automatically and restores exact pending ownership from completed producer-attempt artifacts before new allocations. Keep cancellation-safe ownership artifacts separate from diagnostic reports; never infer cleanup from a newer empty inventory.
- Keep AI usage accounting content-free. Report only the suite's own decision-model usage from the e2e report. Do not record application inference in the app, the Worker, or the test report, and do not read the application's gateway logs. Preserve unknown token measurements. Upload sanitized usage summaries only; never raw logs or ledgers. Use the official @e2e-dev/github reporter for CI checks/comments and keep its GitHub token out of application children. Disable SDK telemetry with E2E_TELEMETRY_DISABLED=1.
