# End-to-end testing

SolZero uses [tester-army/e2e](https://github.com/tester-army/e2e) as its only test runner.
Tests exercise the real Alchemy development stack, Cloudflare Worker routes, D1, Durable
Objects, KV, R2, and the web application. The stack uses the isolated `e2e` configuration
profile with the existing `dev` stage, web port 3000, and API port 3100. Stop other stacks
on these ports before running the suite. Existing applications are never reused.

## Run locally

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
and profile. It validates persisted account, Worker, gateway and token ownership, then
runs normal Alchemy destruction of that isolated local stack. It refuses unknown remote
resources. The dedicated gateway and generated application run token are deleted; replay
cache remains available. Stopping dev alone does not remove account-level resources.

The environment loader reads an explicitly selected `E2E_ENV_FILE`, then this repository's
`config/.env` and `config/.dev.vars`. Values already supplied by the shell or CI win.
It never prints values. The shared local gateway credentials can be selected with
`E2E_ENV_FILE=/Users/jbeckman/projects/personal/alchemy-new/config/.env` on the maintainer's
machine; this path is optional and is never assumed in CI.

Supply `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, and `CF_AI_GATEWAY_E2E_TOKEN`.
The semantic executor calls `@cf/cloudflare/clef` through the Cloudflare Workers AI REST
route with `cf-aig-gateway-id`, defaulting to `default` or `CF_AI_GATEWAY_E2E_ID`.
The token needs permission to execute Workers AI. `CF_AI_GATEWAY_E2E_SKIP_CACHE=1` bypasses
gateway response caching independently of e2e action replay. No Jev or text reasoning
model is substituted. Clef chooses actions and semantic verdicts from the observed tree
and redacted screenshots; exact text values come from `agent.act` params. Use `expect`
for polling and extraction: Clef does not implement `agent.waitFor` or `agent.extract`.

The application runtime model is separate from the semantic test executor. The test
profile declares the existing Workers AI default and provider catalog. `E2E_APP_MODEL`
can select a model that the application actually exposes. Runtime prompt tests require a
working application model provider. The core suite requires a running Docker daemon for
source-image OpenCode and Codex, using the same configured Cloudflare GPT-OSS provider. Setting the semantic gateway token alone does not
supply OpenAI, Anthropic, or harness subscription credentials.

The profile provisions only `e2e-admin@example.test` and `e2e-peer@example.test`.
`E2E_USER_ADMIN_PASSWORD` overrides the disposable administrator password. Otherwise a
random password is generated once in ignored `config/.e2e-password` with mode 0600, so
config loading and worker realms use the same value. Delete that file to rotate it.
These accounts are configured administrators; they are not a substitute for validating
an OIDC ordinary-member deployment. Auth setup uses the real sign-in endpoint and installs
its returned cookies, retaining redacted screenshot support. The separate sign-in test
exercises the visible credential form with e2e secret handles.

`nub run test` and `test:e2e` run core flows, excluding tests tagged `external`.
`test:e2e:all` runs every flow. `test:e2e:external` runs only deferred integrations and
Claude Code. OpenCode and Codex prompts, tools, follow-ups, and history are core flows. External tests fail with a named missing fixture instead of skipping.

## Recorded-action replay

`nub run test` uses verified action recordings in `.e2e/cache`. A warm `agent.act` can
replay its controls and check its recorded final state without Clef calls; the immediate
exact assertions still run. Fresh fixture names are marked with e2e `unique()` in action
parameters, so their current values replace recording slots instead of changing the key.
Keep choices that change the action flow, such as light versus dark mode, ordinary values.

Set `E2E_ACTION_CACHE_DIR` to a fresh ignored directory for a cold/warm comparison without
discarding existing recordings. Run normally first to create verified recordings, then
run the same selection with `test:e2e:cache-strict` and the same directory. `test:e2e:live`
disables action recording and replay; it cannot warm the cache. Strict mode still runs a
step live when no entry exists, so verify `step.cache.mode === "self-finalized"` and zero
model calls in the report rather than relying on the command name.

CI restores only the current branch's replay archives, preferring the same Nub lockfile
then the branch prefix. OS and architecture remain part of the key. Successful suites
save a fresh run-and-attempt archive so repaired recordings reach the next run. Changes
to documentation or accounting scripts do not invalidate the archive; the SDK validates
each step's instruction, parameters, agent context, controls and final state itself.

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

Replay does not replace real application inference. Core Isolate/OpenCode/Codex prompts,
tools, delegation and the bounded provider probe still call the configured provider.
Stack startup, browser/API checks, container startup and those provider calls remain a
speed limit. Live semantic judgments also need a model; the current core suite uses only
`agent.act`, with exact assertions afterward. AI Gateway response-cache hits are a
separate layer and are not evidence of recorded-action replay.

## AI usage accounting

For a local accounting report, run `nub exec tsx scripts/e2e/ai-report.mjs init` before
the tests and `nub exec tsx scripts/e2e/ai-report.mjs summarize` afterward. These commands
use the pinned Node runtime and do not make model calls.

The isolated launcher enables `E2E_AI_USAGE=1`. The API binding defaults to disabled and
also requires the isolated development Worker name. Application records contain only an
allowlisted model, request count, gateway cache result, status, token counts and start
time. They exclude request content, credentials, URLs and identifiers. Accounting does
not add inference calls, retries, or change provider options. Set `E2E_AI_USAGE=0` to
disable application accounting for a local test run.

OpenCode, Codex and the bounded native-provider probe reuse the existing buffered
response parser for measured usage. Isolate binding JSON is observed before the SDK's
fallback zeros. Streaming bindings do not expose HTTP cache headers or reliable usage
presence at that boundary; these measurements remain unknown. Missing token counts or
cache status never imply zero cost. Provider prompt-cache tokens are separate from an
AI Gateway response-cache hit, e2e action replay and a restored GitHub Actions cache.

CI initializes and summarizes usage around the test run and uploads only sanitized
`summary.json` and `summary.md` from `.e2e/ai-usage`. Raw logs and accounting ledgers are
not uploaded. The official `@e2e-dev/github@0.3.3` reporter writes e2e results and SDK-measured
model usage to the job summary and updates its pull-request comment. Core and lifecycle
runs use distinct stable keys. `GITHUB_TOKEN` is scoped to the test step and stripped from
application children. Application accounting remains a sanitized receipt/job summary;
there is no custom AI-only PR publisher. Missing measurements remain explicit.
SDK telemetry is disabled with `E2E_TELEMETRY_DISABLED=1`.

The installed CLI refreshed the pristine `.agents/skills/e2e` guidance and the Claude
skill symlink. `.mcp.json` and `.cursor/mcp.json` invoke the installed MCP server through
`nub run --silent test:e2e:mcp`. The MCP command uses the same registered SDK process and verified exit cleanup as test runs; `--silent` keeps Nub headers out of JSON-RPC stdout. Project-specific Node/Nub, Clef, lifecycle and feedback rules live in
`AGENTS.md` and this guide. Upstream feedback or other outgoing messages require explicit
human authorization.

## Coverage inventory

The actual routes and HTTP groups define this inventory. Every executable test is under
`tests/**/*.e2e.ts`; shared fetch helpers call live endpoints with the test browser's
cookies. Tests never intercept application requests or mock modules.

| Flow | Suite | Exact evidence / prerequisite |
| --- | --- | --- |
| Anonymous route gates, credential sign-in/sign-out, protected APIs | `auth.e2e.ts` | Visible form, settings reached, 401 across all protected groups |
| Settings navigation, runtime defaults, theme persistence, MCP legacy deep link/search | `settings.e2e.ts` | Accessible heading/tab/input, saved step limit survives reload |
| Global secret create, metadata search, delete | `settings.e2e.ts` | Exact key/tag metadata; registered secret input; cleanup |
| API key create, list, authenticated request, revoke; exported schema/OpenAPI contract | `accounts.e2e.ts`, `api-contract.e2e.ts` | Key label visible, live request 200 before revoke and 401 after |
| Global skill creation/default and own enable override/reset/delete | `skills.e2e.ts` | UI toggle survives reload; API enabled/default/override fields |
| Session creation, tool changes, archive and unarchive, reload | `sessions.e2e.ts` | Exact tools and archived title; active state restored |
| Incognito visibility, custom MCP configuration and tools/subagent editor | `advanced-sessions.e2e.ts` | Real list exclusion/direct link, exact preferences survive UI save/reload |
| Attachment-bearing prompt cancellation | `advanced-sessions.e2e.ts`, tag `runtime` | Prompt reaches processing; stop produces failed terminal message; reload retains history |
| Actual child-agent delegation | `advanced-sessions.e2e.ts`, tag `runtime` | Child event and output marker from a real isolate invocation |
| Isolate prompt execution and native Markdown copy | `sessions.e2e.ts`, tag `runtime` | Exact Workers AI `hello` in returned output, assistant card, native clipboard and message-scoped final token after reload, without tools |
| OpenCode and Codex prompt execution | `sessions.e2e.ts`, tag `harness` | OpenCode output marker; Codex exact `hello` in returned output, assistant card and persisted token after reload, without tools; Docker source images |
| OpenCode and Codex multiple tools and follow-up | `harness-tools.e2e.ts`, tag `harness-tools` | Two distinct actual shell calls, successful correlated results, file readback in the same session, persisted token events for both turns |
| Claude Code prompt execution | `sessions.e2e.ts`, tags `external`, `harness` | Compatible Anthropic fixture and real output/history; deferred |
| Authentication transfer redemption and deep-link navigation | `session-transfer.e2e.ts` | Real one-time token/cookie redemption, exact redirect, repeat redemption rejected |
| Foreign-account session access and mutation denial | `sessions.e2e.ts` | Real separate cookies; read/tools/delete/websocket-token all return 404 |
| GitHub repository discovery | `external-integrations.e2e.ts`, tag `github` | Configured linked identity finds exact isolated repository |
| MCP tool execution | `external-integrations.e2e.ts`, tag `mcpcf` | Available server, live invocation, expected fixture output |
| AI Search retrieval | `external-integrations.e2e.ts`, tag `ai-search` | Live source retrieval yields indexed marker |
| Personal BYOK provider save and model call | `provider.external.e2e.ts`, tag `byok` | Encrypted credential metadata, visible provider, actual isolate output; settings restored |
| OIDC member sign-in/admin denial | `identity.external.e2e.ts`, tag `oidc` | Real IdP sign-in, member session, 403 admin API and visible Access Denied |
| Slack-origin session creation | `external-integrations.e2e.ts`, tag `slack` | Linked test user produces session visible in the UI; no external message sent |
| Workflow save, name edit, export, disable/enable, archive | `workflows.e2e.ts` | Saved name survives reload, YAML contains name, live status transitions |
| Workflow JS execution, R2 artifact and run deletion | `workflows.e2e.ts`, tag `workflow-runtime` | Completed run, exact artifact marker and events; real dynamic Workflow binding |
| Invalid manifest rejection | `workflows.e2e.ts` | Live Worker returns 400 before persistence |
| Bot creation, detail, temporary routine creation/deletion | `bots.e2e.ts` | Exact bot heading and routine; no scheduled action is allowed to fire |
| Admin skill/workflow/integration/AI Search pages and summaries | `admin.e2e.ts` | Live authenticated configuration and page headings |

### External fixture preflight

The external suites require an isolated deployment with integrations enabled in its
configuration and identities linked to the disposable test account. Set:

- `E2E_CONTAINER_RUNTIME=1` is the default for the core source-image harness flows. Docker
  must be running, with an application model compatible with the selected harness (`E2E_APP_MODEL`). The container pins pnpm only because the
  third-party AI SDK bootstrap recipes require its bundled lockfiles; repo commands remain Nub.
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
| Claude Code | Gateway providerKeys.anthropic references `S0_CONFIG_SECRETS_CF_AI_GATEWAY_ANTHROPIC_API_KEY`; `E2E_CLAUDE_CODE_MODEL=cloudflare-ai-gateway/anthropic/claude-opus-5` | Anthropic messages-compatible model and container bootstrap |
| OpenCode/Codex (core) | Shipped Workers AI GPT-OSS120b; override independently with `E2E_OPENCODE_MODEL`, `E2E_CODEX_MODEL` | Docker and the configured application Workers AI binding/run token; optional OpenAI gateway models additionally need `S0_CONFIG_SECRETS_CF_AI_GATEWAY_OPENAI_API_KEY` in providerKeys.openai |
| OIDC | `auth.providers.<id>` kind=oidc, issuer/clientId and a chosen clientSecret env reference; signIn/provisionUsers/link capabilities | Isolated IdP clients with localhost callback URLs; distinct admin/member users |
| LiteLLM/BYOK | `aiProviders.litellm.enabled`, baseUrl, `S0_CONFIG_SECRETS_AI_PROVIDERS_LITELLM_API_KEY`, or a personal provider in settings | Compatible reachable model endpoint; per-user provider credential; never reuse the Clef decision token as an application provider |

Fixture values alone do not enable integrations or link accounts. Missing/disabled
integration state is a reported failure in `test:e2e:all`, not passing coverage.

The source-image harness checks reproduced and fixed missing pnpm, unwritable OpenCode
cache directories, missing custom-model registration, and local outbound certificate trust.
The launcher exports trusted macOS system roots to an ignored mode-0600 PEM before Alchemy
starts and adds those roots to the runner's default trust set. It never disables certificate
verification or replaces an explicitly supplied CA bundle.

The configured GPT-OSS Responses route rejected the harness tool schema. Its Chat compatibility
route also rejected replayed tool history. The narrowly scoped adapter uses the documented
native `/accounts/<account>/ai/run/@cf/openai/gpt-oss-120b` Chat route, deliberately requests
buffered JSON with `stream:false`, then emits standard Responses events from the actual result.
The [native Chat model](https://developers.cloudflare.com/workers-ai/models/gpt-oss-120b/)
also supports streaming; this bridge buffers for the tested harness protocol.
The [Responses compatibility endpoint](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/)
requires `stream:false`. Text, call IDs, arguments,
namespace names, tool results, abort signals, scoped application credentials and gateway headers
are preserved. Output arrives after generation completes. Consecutive calls remain in one
assistant turn. Private provider reasoning is omitted; unsupported replay/protocol semantics
fail explicitly. Absent token budgets use 4096 rather than the native 256-token default;
explicit budgets remain unchanged. Native isolate parent and delegated turns receive the same
4096-token default when no explicit turn limit is supplied. The harness tests verify genuine shell writes/readback and
same-session follow-ups with the exposed `reasoningEffort: "low"` fixture for these two tiny
shell operations, including the omission of `sessionKind` in a follow-up request.

Codex tool trials, including runs with low effort selected locally, returned
`max_output_tokens` incomplete responses;
the application returned a bounded failed result after about 70–75 seconds. That negative
API outcome was observed. A later failure also exposed an incorrect thinking/Stop
state after WebSocket replay: `Option.none` was incorrectly treated as a processing message.
The replay now checks `Option.isSome`, and harness regressions require idle controls after
reload or a terminal failure. The tool regression selects
low effort explicitly, writes each file in a distinct call, and reads both files with one
exact `cat` command. It asserts actual commands and byte-exact stdout, rather than the
model summary spelling. Separate simple-prompt tests retain their literal response contract.

A native-request diagnostic later proved that pinned Codex 0.144.5 omitted the selected
reasoning effort for the multi-part Cloudflare model ID. Its fallback model metadata gates
reasoning requests. The small pinned harness patch enables that metadata only for
`@cf/openai/gpt-oss-20b` and `@cf/openai/gpt-oss-120b`, with summaries disabled; user-selected
effort then reaches Workers AI. Nub and Docker apply the same patch. This matches the
[tagged client gate](https://github.com/openai/codex/blob/rust-v0.144.5/codex-rs/core/src/client.rs#L762)
and [upstream custom-model report](https://github.com/openai/codex/issues/30697).
The actual fixed Codex tool/follow-up run passed with all five requests at `low`; completion
counts were 108, 90, 27, 71, and 26 tokens. A later full strict run still encountered a
native output-limit failure. A bounded 8192-token experiment also returned actual
`finish_reason: length` with 8192 completion tokens, so it was reverted: increasing the
limit did not fix this provider behavior. The default remains 4096; no temperature change,
model alias, fabricated tool call, or extra test retry is used.

The Codex case also probes the real provider route inside its exclusively owned shipping
container before asserting the positive result. It verifies the container's current session,
uses the shipping Cloudflare CA with TLS verification, and sends an explicit eight-token
limit. The live negative contract returned HTTP 200, `response.incomplete`,
`max_output_tokens`, and exactly eight output tokens. A full positive tool/follow-up/history
case then passed on the same route. Only status, limit usage and lifecycle metadata are
logged; raw SSE, private reasoning, arguments, headers and credentials are excluded.
The [Cloudflare GPT-OSS Harmony issue](https://github.com/cloudflare/ai/issues/574) describes
related serving problems, but it does not establish the cause of the observed length failure.

The delegation regression requests all events for its returned parent message instead of
the default latest-100 tail. It requires a real child start, correlated completion and parent
tool result with the marker, and no child error. Counts and lifecycle categories are recorded
before cleanup. A strict run failed the earlier tail-only assertion, but pagination eviction
was not reproduced: later real runs had 42 events/17 child events and 37/14. The corrected
strong child contract passed; another run produced malformed parent output and remains a
recorded provider failure rather than evidence of successful delegation.

The user deferred the extra GitHub, Slack, MCPCF, AI Search, Anthropic, BYOK, and ordinary-member
OIDC fixtures. Their authored cases and fail-fast preflight remain available; no live positive
result is claimed for those seven cases.

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
Configure repository secrets `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, and
`CF_AI_GATEWAY_E2E_TOKEN`; the workflow generates and masks a fresh disposable account
password. Do not use production identity or integration secrets for tests.

Each launcher owns `.e2e/runs/<UUID>/stack`, including Alchemy state, simulator D1/KV/R2/DO data and source-container build contexts. It runs the shipping stack and normal Alchemy destruction from that directory. The application gateway and token names contain the same run UUID; local and CI names have separate scopes. Cleanup never treats a shared name or prefix as ownership. Application run tokens have account-level AI permissions; a gateway name is not a token authorization boundary.

The default `test:e2e` command wraps the SDK and verifies recovery after exit. Cleanup failures make the command fail even if SDK teardown ignored the app's exit code. The launcher records exact process birth times and descendants, including detached sidecar groups. Both SDK and Alchemy children must publish a durable launch intent and their own PID/birth before importing the real CLI. Unresolved registration, failed process inspection and a same-birth process moving groups retain evidence and block storage removal. Process inspection and signaling use portable POSIX tools; they cannot eliminate every operating-system identity race. Cancellation signals the owned launcher, and recovery stops only birth-matched descendants before deleting storage. Run `nub run test:e2e:cleanup` again with the same credentials, profile and CI scope after an abrupt termination. Completed receipts make repeated recovery a no-op; active launchers and mismatched ownership are refused.

Cleanup reconciles a token created before its state record was flushed by exact UUID name, account, permission policy and creation time. It verifies gateway/token HTTP 404 and owned Docker label absence before removing the run directory. The directory removal also clears every run-owned identity, auth session/API key, session/workspace/history, bot/routine, agent/skill/MCP definition, uploaded attachment, secret and runtime preference. Most tests also delete their entities or restore settings in `finally`; storage teardown recovers interrupted requests and APIs without individual delete endpoints.

`nub run test:e2e:lifecycle` exercises real success/failure recovery: launcher SIGTERM; SIGKILL with a real Codex container and missing token state; killed CLI leader with detached runtime descendants; an intentionally failing SDK suite; outer-command SIGTERM and SIGKILL after creating an authenticated session; a failed process inspector; and a genuine filesystem publication failure before Alchemy loads; and an official MCP open/observe/close session with valid JSON-RPC stdout and verified app teardown. It verifies receipts, state removal and idempotent recovery. These lifecycle fixtures are excluded from the ordinary core catalogue. To run them on the normal hosted validation job, dispatch `gh workflow run validate.yml --ref feat/e2e -f e2e_lifecycle=true`. The boolean defaults to false, so ordinary PR and push validation still runs only the core suite; an opt-in dispatch adds lifecycle cases after core. Lifecycle reports use `.e2e/cleanup-proof`; intentional inner failures use separate private report directories.

Sanitized CI diagnostics retain `cleanup-summary.json` (counts/types/verified status) for seven days. A separate `solzero-cleanup-ownership-<run>-<attempt>` artifact retains only `cleanup-ownership.json` (repository/run/account hash/profile and exact run-owned resource metadata) for 30 days and uploads even on cancellation. Private state, credentials, logs and journals are never uploaded. Before new allocations, CI examines up to 10,000 repository artifact records and restores pending ownership from completed same-repository Validate attempts, including earlier attempts of the current run. It verifies original producer metadata and byte-equivalent pending rows in immutable dedicated archives. A newer empty or completed inventory does not discard older pending evidence; recovery verifies absence again. Active producers are preserved. Unavailable, conflicting or malformed claimed ownership evidence blocks recovery. Explicit manual recovery can also use a historical diagnostic archive containing the exact ownership file: `CI=1 nub exec tsx scripts/e2e/cleanup.ts /path/to/cleanup-ownership.json`, with the same isolated profile/account and an Actions-read token. Live token IDs are reconciled from exact UUID ownership; supplied IDs do not authorize deletion. Evidence beyond the retention and inventory bounds requires operator review; it is never replaced by a prefix sweep.

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

The workflow verifies Docker, builds the current harness source images through Alchemy,
installs Chromium separately, restores `.e2e/cache`, runs the core suite,
saves replay recordings and uploads reports and failure artifacts. `.e2e/` is ignored
locally. Chromium receives native clipboard read/write permissions through the small
pinned web-engine patch in `patches/`; clipboard contents are never simulated. API keys
have no Copy button in the current UI; the runtime response's existing Copy markdown
control verifies the native permission path. Replay cache is preserved by CI rather than checked into Git. `test:e2e:live`
forces fresh Clef decisions; `test:e2e:cache-strict` fails on stale recordings. Read
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
each passed 31/31. That commit's strict run passed 30/31: the Codex first tool turn
exhausted the native output limit, and its terminal failure UI checks passed.

Full-suite verification at `dc6e3ea` produced these results, with 31 core cases selected and
seven user-deferred external cases excluded:

- Independent live run `01a1092d-7d62-7548-884d-95daef4b75f2`: 30/31 in 261.43 seconds.
  The delegation parent omitted the required marker although its real child and correlated
  tool result contained it. Cleanup removed the failed payload before an exact API-output
  versus final-parent-token comparison; model noncompliance remains a hypothesis, not a
  proven cause.
- Hosted Validate `37242692025`: 30/31. The default-effort Codex prompt exhausted the
  4096-token native output limit before the marker assertion. Its terminal status failed;
  this case did not reach failure-UI assertions. The native effort is inferred absent from
  source, implying Cloudflare's documented medium default; CI request metadata did not
  capture it. Static validation and actionlint passed.
- Independent strict run `01a10932-409a-7b67-b9fd-c76d10d2132f`: 31/31 in 196.91 seconds,
  with six action replays, five cache misses, 15 Clef calls and 30,672 tokens; no skips or
  flaky passes. Strict action replay still executes the real application and provider flows.

Both harness tool/follow-up/history cases and the genuine eight-token negative probe
passed in those three runs. Explicit low effort reaches the Codex provider; the
supported default and 4096-token limit remain unchanged. These results establish actual
positive and bounded-failure behavior, but do not establish stable success across the
native provider flows. These earlier outcomes remain historical evidence; no retry or
provider workaround hides the recorded failures.

The later Codex smoke prompt at `981b51d` requests only `hello`, without tools. Its focused
live run `01a109a6-dad5-7bee-9ccf-eb868203a25c` passed the one Codex case and required
sign-in setup (2/2 selected, 35.36 seconds; Codex case 17.37 seconds). The report records
that immutable commit and a clean checkout. The real source-image Codex runtime used the
configured Cloudflare `@cf/openai/gpt-oss-120b` provider, with the existing default reasoning
and 4096-token budget. Returned output and the persisted final token equal `hello` after
trimming transport whitespace; the browser assertion targets the assistant card before
and after reload, and message-scoped events contain no tool calls. Node 24.15.0 ran the
documented dotenv/CA launcher; no replay, retry or fabricated output was used. Root
typecheck, lint and format passed. This focused result does not replace the earlier
full-suite outcomes or prove provider stability. Reproduce it with:

```sh
E2E_ENV_FILE=/path/to/private.env nub run test:e2e:live tests/sessions.e2e.ts --grep 'codex executes a real prompt'
```

The subsequent full hosted run `37251567618` at `bca93d5` executed zero tests: Cloudflare
rejected creation of another auto-generated AI Gateway at the account's 20-gateway limit.
Repository validation and actionlint passed; this was a startup failure, not 31 test failures.
The lifecycle correction at `5bfd00a` was verified against that real full account. Only the
legacy gateway matched to this repository's local e2e Worker/state/store was removed.
Local creation, real Codex `hello`, deletion and token revocation passed, returning the
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

Hosted validation `37296872909` at `25c3903` passed static checks, actionlint, hosted-recovery initialization and cleanup, but core passed 30/31. The Isolate prompt returned a completed status with 4096 repeated punctuation characters instead of its requested marker. The retained report does not contain that call's native finish reason or usage; the separate eight-token limit diagnostic belongs to the deliberate negative probe. All ten semantic driver steps replayed without model calls, so this failure was outside recorded-action replay.

The Isolate smoke prompt now requests only `hello`, without tools, and checks the exact returned text, assistant-only card, native clipboard and message-scoped final token after reload. This focused real-binding case plus authentication setup passed 2/2 in 29.747 seconds (`01a10ba7-38c0-73b9-890f-477a5ecb6b8e`). Temporary content-free diagnostics observed native `stop`, 2384 input tokens, 40 output tokens, five public text bytes and zero tool calls; the diagnostic was removed. The supported default effort, 4096-token budget and all tool/delegation cases remain unchanged. This is prompt stabilization, not proof of a Cloudflare serving defect repair or a new full-suite pass.
