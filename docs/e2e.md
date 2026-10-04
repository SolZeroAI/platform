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
```

The launcher creates missing `config/.env` and `config/.dev.vars` files with mode 0600,
allowing a fresh CI checkout to start the normal infra command. Node watch requires even
its optional environment-file path to exist. The comment-only files supply no deployment
secrets; real credentials still come from the environment.

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
| Isolate prompt execution and native Markdown copy | `sessions.e2e.ts`, tag `runtime` | Workers AI output marker, exact native clipboard value, persisted messages survive page reload |
| OpenCode and Codex prompt execution | `sessions.e2e.ts`, tag `harness` | Real GPT-OSS output marker and persisted history after reload; Docker source images |
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
Independent live verification at `e0c39c6` passed 31/31 selected core cases, including both
harnesses and the stronger child delegation contract. Hosted Validate `37241453073` at
that commit also passed 31/31. The full strict run `01a1091b-7f12-722c-9d72-8c0bc3d19482`
passed 30/31: the Codex first tool turn failed with a genuine native output-limit result;
its terminal failure UI checks passed. This remains a recorded provider limitation.
The later focused positive/explicit-limit-negative run passed 2/2 in 44.73 seconds;
complete verification of the final added negative probe is still required.
The expanded core includes OpenCode/Codex prompts, tools, follow-ups, and history. See the generated run report for
the current pass/failure count; do not infer a fully verified suite from this inventory.
