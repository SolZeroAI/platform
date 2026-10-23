# Customize a deployment without an application-code fork

Use complete stage JSONC files for non-secret settings and environment bindings for credentials.
Do not rename internal packages, Worker bindings, database keys, or workflow formats to change the
product brand.

## Stage profiles

Set `S0_CONFIG_PROFILE` to select a named profile. For example, `company` selects
`config/company-dev.config.jsonc`, `config/company-pre.config.jsonc`, and
`config/company-prod.config.jsonc`. A `pre-<number>` preview selects the same complete pre file.
Profiles do not merge with the default files. Keep a separate test file when the deployment needs
one.

The infrastructure loader, `config:check`, `config:stage-url`, and `config:write-stage-vars` use
the same profile selector. An explicit `config:check -- --profile <name>` takes precedence over
the environment selector.

Run `nub run config:check` and `nub run test:config` before requesting cloud credentials. The latter
uses the existing e2e runner against the real config compiler and CLI with owned local fixtures. It
does not start an app, allocate cloud resources, or replace the full Worker/browser suite.

## Product identity

An optional, complete `brand` object configures the browser name and assets:

```jsonc
"brand": {
  "name": "My Agent",
  "logoLightPath": "/brands/company/logo-light.svg",
  "logoDarkPath": "/brands/company/logo-dark.svg",
  "faviconPath": "/brands/company/favicon.svg",
  "appleTouchIconPath": "/brands/company/apple-touch-icon.png"
}
```

Place local assets under `apps/web/public`. Asset URLs can also point to an operator-managed host.
The configured logo replaces the SolZero-specific primary loading animation. This keeps a custom
brand from requiring its own React components.

When `brand` is present, it takes precedence as a whole over `VITE_S0_BRAND_*`. When it is absent,
the existing public brand environment overrides and SolZero defaults remain supported. Infra resolves
the effective brand once, includes it in the configuration digest, and compiles browser scalars and
the server's `S0_BRAND_NAME` from that value. Worker requests do not read a deployment file.

The same name appears in OpenAPI/Scalar documentation, agent instructions, workflow-building copy, and Slack responses.
`deployment.appName` controls resource names and the health service identifier
`<appName>-agent-control-plane`. Changing it is a new resource identity, not a cosmetic rename.

`integrations.githubApp.createPullRequestCommand` optionally adds an executable alias such as
`company-create-pr`. Names must be lowercase letters/numbers separated by hyphens, with at most
64 characters. The canonical `s0-create-pr` executable remains available. Runtime skill packages use
the selected command and product name, while existing skill IDs and preference references remain
unchanged. Both the original c0 built-in ID and the SolZero built-in ID are recognized.

The helper requires an agent-container image built from this source. Publish the normal upstream
images and update their release pins before relying on a new alias in deployed containers. A brand
change does not require a separate per-company image.

## Auth, providers, and integrations

Configure auth capabilities, administrator identities, provider endpoints/defaults, GitHub App IDs,
Slack, MCP Context Forge, timeouts, and observability in the stage file. Keep every active secret as
an explicit `{ "env": "SECRET_NAME" }` reference. A provider display name does not grant sign-in or
linking authority. Preserve encryption keys when importing encrypted records.

The existing LiteLLM default remains authoritative when both LiteLLM and Cloudflare AI Gateway are
enabled. Adding the gateway must not silently replace the existing default model.

## API routing

Separate web/API domains remain the default (`deployment.apiRouting: "subdomain"`). To expose one
public origin instead, set `deployment.apiRouting: "same-origin"`, set `zone` and `webFqdn`, and
omit `apiFqdn`. The public API base becomes `https://<webFqdn>/api`; Better Auth remains at
`/api/auth/*`. This mode intentionally supports the fixed `/api` prefix, not arbitrary mount paths.

Cloudflare routes `<webFqdn>/api` and `<webFqdn>/api/*` directly to the API Worker. The web Worker
owns the custom domain and UI paths. API custom domains and workers.dev access are disabled in
this mode. Keep the hostname proxied in the configured zone, and review route ownership in the
Alchemy plan. Switching an existing deployment detaches its API domains; keep the old stack on
its existing mode during a blue/green migration.

Server-side web requests use the `S0_API` service binding, not the public origin. The combined stack
binds the API it creates; a separate web stack references `S0Api` in the same stage, so deploy the
API stack first. Local development and workers.dev previews forward `/api` through that binding.
They preserve caller headers, bodies, redirects, streaming and WebSocket responses. The API owns
session/API-key authentication and webhook signature checks; the web fallback imposes no browser
session requirement on API clients or webhooks. Internal MCP endpoints retain their existing guards.

Generated workflow and Slack URLs, agent callback bases and OpenAPI servers use the public API
base, never a service-binding origin. Workflow/webhook IDs do not change. Update external callers,
OAuth provider callbacks, GitHub App webhooks and Slack request URLs when moving public domains.
Auth callbacks stay under the web origin's `/api/auth`, without a doubled `/api` prefix.

`nub run test:config` includes owned local Worker transport tests. The full browser suite's profile
selects same-origin mode; run that suite and review deployed routes, OAuth, signed webhooks,
streaming, WebSockets and observability before cutting over a production hostname.

## Private deployment CI

The shared templates support `master` only. Set repository variable `S0_CI_RUNNER` to
`ubuntu-latest` when a fork does not use the default Blacksmith runner. Set repository variable
`S0_CONFIG_PROFILE` so static validation checks the fork's profile. In each GitHub environment
(`pre` or `prod`), set `S0_CONFIG_PROFILE`, `DATABASE`, `APP_DB_MODE`, and
`PLANETSCALE_ORGANIZATION` as needed. Empty `DATABASE` retains D1. PlanetScale deployments need
`PLANETSCALE_SERVICE_TOKEN_ID` and `PLANETSCALE_SERVICE_TOKEN` secrets.

Keep Cloudflare account credentials in the matching environment so pre and prod can use separate
accounts without changing workflow source. Environment secrets override repository secrets of the
same name. Rotate GitHub App secrets in place as `GH_APP_PRIVATE_KEY`, `GH_APP_CLIENT_SECRET`, and
`GH_APP_WEBHOOK_SECRET`; the workflows compile them into the existing `GITHUB_APP_*` bindings.
The templates also pass the explicit Okta secret reference.

Ephemeral PR previews stay on D1. Standing pre and production can select PlanetScale. Do not enable
paid per-PR databases until their provisioning, ownership receipts, and cleanup are supported.
Public SolZero deployment guards and release ownership guards remain in force.

## PlanetScale provisioning

`deployment.planetscale` is optional and applies only to remote `DATABASE=planetscale` stages:

```jsonc
"planetscale": {
  "clusterSize": "PS_10",
  "logicalDatabaseName": "s0",
  "region": "aws-us-east-1",
  "arch": "arm",
  "replicas": 0,
  "majorVersion": "17"
}
```

Supply both cluster size and logical name when overriding. Without this object, the existing `PS_10`
size and `s0` logical database remain unchanged. Optional fields otherwise retain provider defaults.
Replicas must be zero or at least two. Choose available SKUs and regions for the destination organization;
validation checks shape, not live availability. Review Alchemy's plan before changing existing databases:
region, architecture and replica changes can require replacement in the provider.

## Moving accounts or domains

New account credentials do not transfer old resource identities. Plan separate source-read and
destination-write access. Select the new zone and exact web/API hosts before changing deployment
profiles, auth callbacks, GitHub webhook URLs, Slack callbacks, or external workflow webhooks.

Database copy tooling moves relational rows only. Inventory workflow/skill R2 objects, persistent KV,
encrypted values, Durable Object conversation history, active Workflow executions, schedules,
AI Search sources, and observability destinations separately. Preserve workflow IDs and webhook IDs.
Do not assume that copying a session index row moves its Durable Object history or running work.
See [offline migration](migration.md) for transfer tooling and compatibility gates.

Keep the old stack available until data and functional checks pass. A rollback after new database
writes needs explicit reconciliation; it is not just a previous Worker version.
