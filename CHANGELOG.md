## solzero@2.0.0

### Open created bot details

The bot route now renders its detail page after creation and direct navigation.

### Honor Codex reasoning effort for Cloudflare GPT-OSS

Codex now forwards the selected reasoning effort when running the supported Cloudflare GPT-OSS models. A pinned harness compatibility patch enables their reasoning metadata while keeping summaries disabled; other models retain their existing configuration.

### Show AI usage in end-to-end checks

End-to-end checks now report model requests, measured token counts, cache results,
durations and estimated charges. Same-repository pull requests receive a summary when
uncached inference occurs. Missing provider measurements remain unknown. Summaries
exclude request content and credentials.

### Release isolated test gateways after validation

Cloudflare end-to-end checks reuse dedicated test gateway names and destroy their owned
infrastructure after each CI run, including revoking the generated application run token.
Local test operators can run `nub run test:e2e:cleanup` after stopping the stack. Cleanup
validates ownership and leaves production and shared gateways unchanged.

### Start container harnesses with their required bootstrap dependency

The agent container includes the pinned pnpm runtime required by the AI SDK harness bootstrap recipes. This supplies the missing executable needed at startup. The non-root runtime user also owns the OpenCode cache directory so its native CLI can complete bootstrap. Isolated end-to-end container runs build the current runtime sources and Dockerfile locally; deployed environments receive the change when release CI publishes updated image digests. Repository development continues to use Nub.

### Continue existing harness sessions

The session run API now inherits an existing session's kind when a follow-up request omits it. OpenCode and Codex follow-ups no longer fail with an incorrect isolate-kind conflict.

### Complete delegated GPT-OSS turns

Isolate parent and child turns now use a 4096-token output budget for native Cloudflare GPT-OSS when no explicit limit is supplied, avoiding its short default during tool execution and delegation.

### Register Cloudflare model IDs in the OpenCode harness

OpenCode registers custom Cloudflare Responses model IDs in its generated OpenAI provider configuration, allowing the configured Workers AI model to resolve. Typed OpenCode errors retain their display message instead of becoming `[object Object]`. The isolated local launcher supplies trusted macOS system roots to Alchemy and workerd without overriding a caller's CA bundle or disabling certificate verification.

### Search secrets with long names

Secret search applies literal matching after user-scoped database selection, avoiding D1 pattern-length errors for longer names.

### Restore idle controls after reopening a session

Reopening a completed or failed session no longer leaves the agent thinking indicator and Stop button active. The message composer and model selector become available when there is no processing message.

### Keep sign-in input when the page first opens

The sign-in form now waits until its event handlers are attached before accepting input. This prevents early input from being lost and stops credentials from being submitted as a native GET request during hydration. Authenticated forms show the existing loader until they are interactive.

### Select subagent preferences in the tools dialog

Subagent options now appear above the tools dialog and accept pointer selection.

### Run OpenCode and Codex with Cloudflare GPT-OSS

OpenCode and Codex can now complete prompts, execute shell tools, and continue sessions with the configured Cloudflare GPT-OSS model. SolZero bridges buffered native Chat output to the Responses stream required by the harnesses, preserving actual text, tool calls, and results. Output is delivered after the provider finishes generating it.

### Export the current workflow name

Workflow YAML exports now use the saved name after renaming a workflow, matching the workflow detail page.

### Keep sign-in on Better Auth 1.7

SolZero now uses Better Auth 1.7.7. Email and password sign-in, GitHub linking, and session cookies stay the same.

If this deployment registers a custom OIDC provider, set the identity-provider redirect URI to `<authBaseUrl>/api/auth/callback/<providerId>`. The previous `/api/auth/oauth2/callback/<providerId>` path is no longer used.

### Clean test resources after failures and cancellation

End-to-end runs now isolate simulator data, containers, gateways and application tokens by run ownership and verify their removal after success, failure or cancellation. Interrupted runs retain guarded recovery receipts instead of sweeping shared development data. Preview cleanup verifies the current pull request lifetime and owned resource absence before reporting success.

### Reuse verified browser actions across test runs

End-to-end checks can replay recorded browser actions with fresh fixture data while
still checking exact results. CI restores recordings from the same branch and saves a
new archive after each successful run, including rerun attempts. Reports show action
replay and live model calls separately from AI Gateway response caching.

### Preserve unsaved runtime settings

Background provider refreshes no longer discard an edited Isolate step limit when the saved value is unchanged. The input becomes editable after its saved baseline is initialized.

### Deploy from the alchemy.new registry

<!-- creative: {"title":"Deploy SolZero from the alchemy.new registry.","bullets":["The release publishes a ready package for that version.","The deploy sandbox does not install dependencies."],"workType":"feature"} -->

alchemy.new deploys SolZero from registry package `solzero/platform`. The release workflow publishes that package for the release it just created. The project manifest is uploaded separately and is not inside the archive. The deploy sandbox does not clone the tag or install dependencies. Agent container images stay pinned by digest. A release that did not publish the package cannot be deployed on alchemy.new. Releases published before this package, including v1.8.0, stay undeployable there until you select a release that published it.

Allow the publisher at alchemy.new before the first deploy. The repository is `SolZeroAI/platform`, the workflow file is `release.yml`, the git ref is `refs/heads/master`, and the GitHub Environment is `alchemy-new`.

### Validate complete deployment profiles

Configuration checks now include a named profile's test-stage file when it exists. Rewriting an
existing stage-secret file also restores private file permissions, rather than preserving a broader
mode from an earlier copy.

### Customize a deployment without changing application code

Deployment profiles can now define a complete product brand for the browser, API documentation, agents, and Slack.
Custom logos also replace the primary loading mark. Existing brand environment overrides remain
supported when the profile does not define a brand.

Operators can configure a pull-request helper alias while preserving existing skill identities.
Deploy an updated agent-container image before using this alias. Health responses now identify the
configured application as `<appName>-agent-control-plane`.

Private deployment templates support named profiles, configurable runners, Okta credentials, and
PlanetScale credentials for standing environments. Ephemeral pull-request previews remain on D1.

Remote PlanetScale capacity, region and logical database name can be configured without code changes.

### Verify an offline migration before cutover

The D1-to-Postgres copier now uses bounded batches, rejects unmapped data, preserves legacy built-in
skill identities, and independently verifies row counts and checksums. Apply requires an explicit
write-freeze acknowledgement. Reports omit secret values.

Operators can export and verify R2, KV and schema-compatible session state through a separate temporary
authenticated Worker. Rehearse first: running work, alarms, external resources and incompatible historical
schemas require explicit cutover handling. Keep both stacks offline during the final transfer and follow
the migration runbook before enabling the destination.

### Serve the API from the web origin

The API is now served only at the web application's `/api` path. Public requests route directly to the API Worker, while server-rendered pages use a private service binding. Workflow webhooks, Slack callbacks, agent URLs and OpenAPI use the `/api` base.

**Breaking:** the separate `api.<webFqdn>` hostname and the `deployment.apiFqdn` setting are removed, and configuration files that still set `apiFqdn` fail validation. Update external callers, OAuth provider callbacks, GitHub App webhooks and Slack request URLs to the `/api` base before upgrading a deployment.

### Skip Cloudflare deploys until a fork opts in

Deploy and Deploy Preview run only when the repository variable `CLOUDFLARE_DEPLOY` is `true`.
The public repository does not set that variable, so it does not need `CLOUDFLARE_API_TOKEN`.

A fork that deploys sets `CLOUDFLARE_DEPLOY` to `true` and sets `CLOUDFLARE_API_TOKEN`.
Put production deploy secrets in a `prod` environment limited to `master`. Only the Deploy job uses that environment.

### Run a local stage without an account AI Gateway

Set the optional top-level `aiGatewayLayer` to `mock` in a stage configuration to answer Workers AI model calls inside the Worker. Each answer repeats the user's message. That stage does not provision an account AI Gateway, secrets store, or run token, and it does not need a Cloudflare API token for model calls. Use it only for local testing. Omit the field or set it to `live` for every deployed stage.

### Select end-to-end test models with shared settings

End-to-end checks read the decision model from `E2E_DECISION_MODEL` and the language
model from `E2E_LANGUAGE_MODEL`. CI reads both from SolZeroAI organization Actions
variables. Without them, local runs use Cloudflare Clef and Claude Haiku 5.5 through the
account's default AI Gateway. Third-party models such as Claude Haiku bill through
Cloudflare Unified Billing.

### Build agent container images with each release

The OpenCode, Codex and Claude Code agent containers now use images built from the same commit as
the release. Each release pushes its images to GHCR with the release tag, and the alchemy.new
package deploys those exact images. A deploy from a git checkout builds the images from
`packages/agent-container/Dockerfile` and rebuilds them only when that source changes, so Docker
must run during the deploy. The repository no longer stores image digests.

### Run Workers AI models through the Agents SDK provider

Isolate sessions now reach Workers AI models through `createAI` from the Cloudflare Agents SDK (`agents` 0.30) instead of the deprecated `workers-ai-provider` package. The Think runtime moves to 0.20. Model selection, reasoning effort, and the deployment's AI Gateway stay the same. No operator action is required.

### Declare 201 Created for new API keys

The OpenAPI document now lists `201 Created` for `POST /auth/api-keys`, which matches what the API already returns. The API Keys, ContextForge token, and Data Controls settings now use the typed API client.

### Keep Cloudflare credentials in organization secrets

`nub run github:sync-env-secrets` no longer uploads `CLOUDFLARE_ACCOUNT_ID` or
`CLOUDFLARE_API_TOKEN`. SolZeroAI holds them as organization Actions secrets, and a repository
or Environment copy would override them. A fork that deploys sets these two secrets itself.

### Keep interleaved reasoning when saving custom providers

Saving provider settings no longer drops a custom model's `interleaved` reasoning setting. The OpenAPI contract for `/providers` now lists the shared provider override and custom provider fields, the allowed reasoning efforts, and interleaved reasoning, instead of open JSON records. The web app loads and saves provider settings through the typed API client.

### Describe repository responses in the API contract

The OpenAPI document now describes each repository that `GET /repos` returns, with its permissions and stored metadata. The repository metadata endpoints describe the metadata fields. The web app reads repositories through the typed API client.

### Show archived chats again

The Data controls settings page lists archived chats again. The `GET /sessions` contract now describes the response that the Worker sends: `sessions`, `total`, and `hasMore`. The contract no longer declares `limit` and `offset`, which the Worker never sent.

### Describe session list rows in the API contract

The OpenAPI document now describes each session that `GET /sessions` returns. A failure that a session returns now carries the typed error fields (`_tag` and `message`) beside `error`, so API clients read its message. The agents table and the archive action use the typed API client.

### Use the typed API client for session page actions

The session page's archive, unarchive and agent tools actions, and the tools dialog's MCP Context Forge and AI Search lists, now use the typed API client. A failed action shows the server's error message. The unused `BackgroundSessionsClient` module is removed from the web app.

### Use the typed API client for session prompts and socket tokens

The session page and home page send queued prompts, Okta resumes and websocket token requests through the typed API client. A failed prompt now shows the server's error message instead of the raw response body. Streamed isolate prompts still use `fetch`, because the API contract declares only the queued reply.

### Name the error type in API error responses

API error responses now include `_tag` (for example `NotFoundError`) and `message` beside the existing `error` field, so typed clients built from the published OpenAPI contract can decode them. The `error` field is unchanged. The web app now loads and saves secrets through that typed client.

### Describe workflows, runs and run events in the API contract

The OpenAPI document now describes each workflow, run and run event that the workflow routes return, and the manifest migration that a workflow save applies. The workflows page loads, saves, renames, enables, disables, deletes and runs workflows, and reads runs and run events, through the typed API client. A failed request shows the server's error message.

### Describe workflow Slack apps and builder drafts in the API contract

The OpenAPI document now describes a workflow's Slack app setup and the latest workflow builder draft. The Slack app dialog, the AI builder draft and run artifact previews use the typed API client, and a failed request shows the server's error message.

### Load bot pages before they open

The bots list and bot detail pages load their data while the page opens, and start loading when you point at a bot link. A failed load shows the server's message with a Retry button. After you sign in, every open page loads its data again for your account.

### Stop local end-to-end runs on exit without crash recovery

End-to-end runs are local only, so the test launcher no longer keeps process journals or recovery receipts. When e2e stops the app target, the target stops `alchemy dev`, removes the run's labelled Docker containers and images, and removes its run directory.

The `test:e2e:cleanup` and `test:e2e:lifecycle` scripts, the lifecycle test suite, and the `e2e_lifecycle` input of `Validate` are removed. After a SIGKILL, stop leftover processes by hand.

### Deploy pull request previews on demand

On a fork that sets `CLOUDFLARE_DEPLOY`, a pull request no longer deploys a `pre-<number>` preview stage on every push. Add the `preview` label to deploy one. Later pushes redeploy it while the label stays. Remove the label or close the pull request to destroy the stage.

The new `PR Preview` workflow owns these stages. Fork operators must enable it on their Actions page and create the `preview` label. To destroy an orphaned stage, use **Run workflow** on `PR Preview` and enter the `stage`. **Run workflow** on `Deploy Preview` now only refreshes standing `pre`.

### Load settings panes before they open

The agent skills, data controls and API access settings load their data while the page opens. A failed load shows the server's message with a Retry button.

### Simplify PR preview cleanup

PR preview cleanup no longer captures, uploads or restores ownership artifacts. After the destroy, it checks by stage name that no Worker, Durable Object namespace, container application, D1 database, R2 bucket, KV namespace, workflow, AI Gateway, API token, provider-key secret or AI Search namespace of the stage remains.

### Load workflows before the page opens

The workflows page loads the workflow list, and the workflow that the link opens, while the page opens. A failed list load shows the server's message with a Retry button.

## solzero@1.8.0

### Deploy SolZero from alchemy.new

SolZero can deploy from a GitHub release on alchemy.new. A fresh Cloudflare account uses workers.dev when the stage zone is localhost. Agent containers start from public GHCR images pinned by digest. Sign in as admin@example.com with the administrator password alchemy.new shows once.

## solzero@1.7.0

### Optional PlanetScale control-plane database

SolZero now ships two control-plane database flavors in one package. Cloudflare D1 remains the
default when `DATABASE` is omitted. Operators who outgrow the 10 GB D1 limit can set
`DATABASE=planetscale`. That path needs `PLANETSCALE_SERVICE_TOKEN_ID`,
`PLANETSCALE_SERVICE_TOKEN`, and `PLANETSCALE_ORGANIZATION` for remote PlanetScale. Session chat,
Durable Object sqlite, R2, and Cloudflare AI Search stay on both flavors. PlanetScale is a paid
service with no free plan and is not a deployment provider.

### One-shot D1 to PlanetScale copy

Operators can copy control-plane rows from a D1 dump into PlanetScale with
`nub run db:copy-d1-to-planetscale`. This is a convenience copy, not an online
migration. Production stays on D1 until the operator deploys. The default
dry-run prints the jsonc and env edits for `DATABASE=planetscale` and writes
nothing.

### Better Auth email verification on PlanetScale

PlanetScale stores Better Auth `emailVerified` as a boolean so the postgres
adapter can write true and false.

### Popular secret tag order on PlanetScale

Popular secret tags now sort by numeric count on PlanetScale. A tag used ten
times ranks above a tag used twice.

### Local admin password matches the running Worker

`nub run auth:admin-password -- dev --local` now reads the same local Alchemy
state the Worker uses. After local disk state became the default for `dev`,
the helper still read Cloudflare state, so the printed password did not sign
in.

### PlanetScale sign-in after a local or Hyperdrive boot

Credential sign-in and `/api/auth/config` now work when `DATABASE=planetscale`.
The Worker already created a postgres.js client for Hyperdrive; it then rejected
that client because postgres.js exposes a function, not a plain object. Auth
config returned 500 and the welcome form could not load.

The Worker also kept that Hyperdrive client on the isolate `env` object and
reused it on the next request. Cloudflare Workers reject that I/O reuse, so
sign-in after a successful auth-config request failed. Each request now gets
its own postgres.js client.

Better Auth session inserts now serialize timestamps as ISO strings. workerd
rejects postgres.js binds of `Date` objects, so a valid password still returned
500 after credential check.

## solzero@1.6.0

### Bots can create standing and temporary routines

Each bot can create its own routines. Standing routines keep running until the bot deletes them. Temporary routines watch finite work such as pull request checks and are deleted when that work is done or when the deadline passes.

### Safer decode at bot, session, workflow, and alarm edges

SolZero now parses untrusted bot, session, workflow, and alarm payloads before they reach runtime code. Operators see safer decode of stored rows, manifests, and artifact metadata.

### Alchemy 2.0.0-beta.74 and Turbo 2.10.11

SolZero now deploys and builds with Alchemy 2.0.0-beta.74 and Turbo 2.10.11. The next deploy adopts existing D1 migration history into Alchemy's migration table. Operators do not need a special action beyond that deploy.

### Deploy previews from GitHub Actions

The new `Deploy Preview` workflow deploys the `pre` stage on each merge to `master`. Each pull
request deploys an ephemeral `pre-<number>` stage and posts its preview URL as a pull request
comment. The workflow destroys the ephemeral stage when the pull request closes. A manual dispatch
input removes an orphaned `pre-*` stage.

The `Release` workflow now starts after `Deploy Preview` succeeds on `master`. Deployment operators
must set the GitHub `pre` environment secrets and the repository Cloudflare secrets. Run
`nub run github:sync-env-secrets` to upload them.

### Show the real product version in the app

The web sidebar and the API health endpoint now display the product version from the repository
`VERSION` file, followed by the short commit hash of the deployed build, for example
`v1.5.0-036d0b`. Deployments previously displayed `v0.0.0` because they read the placeholder
workspace package version.

A build that contains commits after the release tag also shows the unreleased commit count, for
example `v1.5.0+2-bbb222`. A build deployed from the release tag itself, such as a production
deployment, keeps the plain `v1.5.0-036d0b` form. The count needs the release tag and full history
in the deploy checkout; without them the label omits the count.

## solzero@1.5.0

### Route model traffic through Cloudflare AI Gateway

<!-- creative: {"title":"Send every model through one reliable gateway.","bullets":["Route SolZero agents through Cloudflare AI Gateway.","Manage models and provider keys from one catalog."],"workType":"feature"} -->

SolZero now provisions Cloudflare AI Gateway as its default model gateway. Each deployment profile
can set a model allowlist and choose its default model. Sessions that run in Isolate, OpenCode,
Codex, or Claude Code can select a compatible gateway model.

Administrators can supply provider keys through deployment-managed secrets or the Admin dashboard.
A user can also set a personal provider-key override. SolZero keeps injected container credentials
in trusted Worker code.

Deployment owners must grant the Cloudflare API token edit access to AI Gateway and Secrets Store
before provisioning.

### Publish branded release visuals

<!-- creative: {"title":"Give milestone releases a launch moment.","bullets":["Publish a polished social card for minor and major releases.","Render each card directly from structured release data."],"workType":"feature"} -->

SolZero minor and major releases now include a branded release-notes card. The card uses the SolZero
logo, Manrope font, and Kumo colors. Two layouts support feature summaries with different content
density. Short social copy can sit beside the full technical release note. Work-type badges and
high-contrast bullets make each highlight easier to scan. The structured templates keep each
release image simple and consistent.

Tegami sends the release data to Takumi during minor and major version preparation. Takumi renders
the image through its native Node binding. The version pull request includes the result, and the
GitHub release notes display the card from the release tag. Patch releases use text-only notes.

### Choose between two SolZero loader treatments

<!-- creative: {"title":"See SolZero come alive.","bullets":["Use Clean clockwise as the primary loading indicator.","Preview Form spin as an alternative treatment."],"workType":"ux"} -->

Clean clockwise is now the primary loader across the web app. The Learn More Assets section also
shows Form spin as an alternative treatment. The earlier motion study gallery has been removed so
the page presents only these selected loaders.

### Show sign-in failures in a toast

SolZero now shows failed sign-in messages in a Kumo error toast. The sign-in form stays stable while
the message remains visible and accessible.

### Source and releases live at SolZeroAI/platform

The SolZero platform repository is https://github.com/SolZeroAI/platform. Clone the repository, file
issues, and read GitHub Releases at that URL. After an organization owner renames the GitHub
repository, GitHub redirects https://github.com/SolZeroAI/solzero to the new name.
