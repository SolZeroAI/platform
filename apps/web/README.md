# SolZero Web Client

The SolZero web client is the shared interface for the SolZero platform. People use it for the
custom Agent, the agentic Workflow builder, always-on bots, organizational context, and
administration. It is a TanStack Start and Kumo application deployed to Cloudflare Workers through
Alchemy v2.

## Features

- Isolate Agent sessions tuned for latency, cost, and capability.
- Sandboxed Codex, Grok, Claude Code, and OpenCode harness sessions for deeper work.
- Always-on bots that stay connected the way a Grok Bot does, including Slack and GitHub. Each bot can create standing routines and temporary watches. A temporary routine is deleted when the watched work is done or the deadline passes.
- Durable deterministic and agentic Workflows, including approvals, session reuse, and response
  caching.
- MCP tools, skills, MCP Context Forge, and Cloudflare AI Search sources.
- Deployment-managed credentials plus configurable social and OIDC sign-in through Better Auth.
- Linked GitHub and Slack accounts.
- An Admin dashboard for runtime-managed integrations and platform settings.
- Real-time session streaming, tool calls, sub-agent activity, and multi-participant presence.
- A responsive interface for desktop and mobile.

## Setup

### Prerequisites

- Node.js 24.15.x
- Nub
- Control plane running (e.g. `nub run dev` from repo root)

### Authentication Setup

The default deployment provisions each explicit admin email with a deployment-managed Better Auth
credential. Social and generic OIDC providers may independently be allowed to sign in, provision,
or link accounts. Matching email addresses are never implicitly linked.

Configure admin addresses, provider capabilities, public client settings, and integration
settings in the stage file, such as `config/dev.config.jsonc` or `config/prod.config.jsonc`. Ephemeral
`pre-*` deployments use `config/pre.config.jsonc`. Each file is complete and has no inherited profile.
The default credential provider uses the configured admin addresses and can generate its password
through Alchemy.

`config/.dev.vars` contains only secret values referenced by `config/dev.config.jsonc`. Copy
`config/.dev.vars.example`, then uncomment and populate only the secrets needed by the enabled
integrations. These may include:

- `BETTER_AUTH_SECRET` (optional; Alchemy generates it when absent)
- `S0_CONFIG_SECRETS_AUTH_ADMIN_PASSWORD` (optional; Alchemy generates it when absent)
- `S0_CONFIG_SECRETS_AUTH_PROVIDERS_<PROVIDER_ID>_CLIENT_SECRET` for each enabled external provider
- `GITHUB_APP_CLIENT_SECRET`
- `GITHUB_APP_PRIVATE_KEY`
- `GITHUB_APP_WEBHOOK_SECRET`
- `SLACK_TOKEN`

Run `nub run config:check` after changing JSONC. Retrieve the Alchemy-generated admin password for
local development with `nub run auth:admin-password -- dev --local`, or for a deployed stage with
`nub run auth:admin-password -- <stage>`. Change the password by setting the
environment variable named by `auth.adminPassword.env` and restarting or redeploying the stack; SolZero
updates the Better Auth hash and revokes existing managed-credential sessions. MCP Context Forge
may separately use a linked provider configured for its OAuth integration.

GitHub App repository permissions should be configured as:

- Contents: read/write
- Pull requests: read/write
- Metadata: read

### Browser Configuration

Alchemy compiles the browser-safe subset of the selected stage config into explicit `VITE_*` values for
the web build. The web app does not parse JSONC at runtime and never receives server secrets or the
full server configuration. Authentication providers are configured in the API worker, not in the
TanStack app.

### Brand Configuration

The browser defaults to the SolZero name and supplied SolZero assets. Override them at build time
with these public browser values:

- `VITE_S0_BRAND_NAME`
- `VITE_S0_BRAND_LOGO_PATH` (one logo path for both themes)
- `VITE_S0_BRAND_LOGO_LIGHT_PATH`
- `VITE_S0_BRAND_LOGO_DARK_PATH`
- `VITE_S0_BRAND_FAVICON_PATH`
- `VITE_S0_BRAND_APPLE_TOUCH_ICON_PATH`

Use a public URL or a path to a file copied under `apps/web/public`, such as
`/images/custom-logo.svg`. The shared logo override takes precedence over the theme-specific
values. These values are intentionally browser-visible and must not contain secrets.

### Local Run

From the repo root:

```bash
# Install dependencies (links workspace packages)
nub install

# Start the control plane and web app together
nub run dev
```

The web app runs at http://localhost:3000 and proxies API calls to the control plane at http://localhost:1337.

If you want to run them separately:

```bash
nub run dev:api
nub run dev:web
```

### Scripts

```bash
nub run dev         # Development server
nub run build       # Production build
nub run preview     # Preview the production build locally
nub run deploy:dev  # Deploy the web app to the dev stage via Alchemy
nub run deploy:pre  # Deploy the web app to the pre stage via Alchemy
nub run deploy:prod # Deploy the web app to the prod stage via Alchemy
nub run deploy      # Alias for deploy:prod
nub run typecheck   # Type check
```

## Programmatic Client

For headless or script usage, the `BackgroundSessionsClient` is available:

```ts
import { BackgroundSessionsClient } from "./src/session-client"

const apiKey = process.env.S0_API_KEY
if (!apiKey) {
  throw new Error("S0_API_KEY is required")
}

const client = new BackgroundSessionsClient({
  auth: { kind: "api-key", apiKey },
  baseUrl: "http://localhost:1337",
})

const session = await client.createSession({
  repoOwner: "cloudflare",
  repoName: "sandbox-sdk",
  title: "Investigate flaky e2e test",
})
```

Browser code should instead use `auth: { kind: "browser-session" }` with the same-origin
`/api` BFF. Do not embed a user API key in a browser bundle.

## API Routes

- `/api/auth/api-keys` - create/list user API keys
- `/api/auth/[...all]` - Better Auth proxy routes
- `/api/sessions` - Session CRUD (proxies to control plane)
- `/api/sessions/[id]/*` - Session archive, prompt, ws-token (proxies)
- `/api/repos` - Repository list (proxies)
- `/api/secrets` - Global secrets (proxies)
