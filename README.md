![SolZero Agent landing page](docs/solzero-landing.jpg)

# SolZero

SolZero is an open-source AI platform built for enterprise work, tools, and context.

## What Makes SolZero Compelling?

### SolZero Agent Harness

SolZero Agent is a custom harness built on Cloudflare Workers and Durable Objects. It is the default
runtime for everyday work, with low startup overhead and no container to provision for each
session. [Cloudflare Workers](https://developers.cloudflare.com/workers/reference/how-workers-works/)
run globally and bill for requests and active CPU time rather than wall-clock duration, which makes
the Isolate harness a strong fit for interactive and event-driven agent work.

Built-in context compaction and searchable durable conversation history keep long-running sessions
focused and efficient. Skills and MCP tools bring organizational context into the agent when it is
needed. Sub-agents scale out dynamically as independent, durable SolZero Agent instances without
provisioning another container.

### Full sandboxes for deeper work

Some tasks need a complete development environment. SolZero also supports sandboxed OpenCode, Codex,
and Claude Code agents with a full Linux filesystem and shell. These runtimes have more startup and
resource overhead than SolZero Agent, but they are a better fit for deep coding and other work that needs
full system access.

### Workflows for deterministic and agentic automation

Workflows are one of our favorite parts of SolZero. They are fast to build, easy to adapt to a team's
processes, and useful for weekly reports, day-to-day operations, proactive automation, and reactive
incident workflows.

SolZero Workflows combine deterministic nodes with non-deterministic agent steps. They run on Cloudflare
Workflows and support durable execution, schedules, webhooks, human-in-the-loop approvals, session
reuse, and response caching. Reusing a session or cached response can reduce repeat model calls,
latency, and token spend.

## Integrations

SolZero includes integration code for:

- Credential, social, and generic OIDC authentication through Better Auth, including Okta through
  OIDC.
- Cloudflare AI Gateway with GPT OSS 120B Starter by default and GPT 5.6 Luna, GPT 5.6 Sol,
  Claude Opus 5, and Grok 4.5 as options, plus optional LiteLLM providers.
- MCP servers, skills, and MCP Context Forge.
- GitHub Apps and Slack.
- Cloudflare AI Search for built-in, R2, and website data sources. SolZero can create and manage these
  sources from the Admin dashboard, so teams do not have to manually provision and integrate a
  separate vector database themselves.

Deployment owners can manage non-secret platform configuration in a stage-specific JSONC file.
Integrations that are not deployment-managed can be configured at runtime through the Admin
dashboard. Deployment-managed values take precedence, which keeps an organization's required
configuration explicit and reviewable.

The source code for these integrations is included, but external services, accounts, and credentials
are not. Alchemy provisions the default Cloudflare AI Gateway, attaches the account Secrets Store,
configures deployment-referenced provider keys as Cloudflare BYOK defaults, enables gateway
authentication, and mints a least-privilege runtime token with `Workers AI Read` and
`AI Gateway Run`. Isolates use the native AI binding for Workers AI and provider-native Gateway
endpoints for third-party BYOK models.
Compatible Container harnesses use Cloudflare Containers outbound interception to inject gateway
and provider credentials in trusted Worker code without exposing raw keys inside the container.
OpenCode supports all configured gateway protocols, Codex supports OpenAI Responses models such as
GPT OSS 120B Starter, Luna, and Sol, and Claude Code requires an Anthropic Messages model.
GPT OSS 120B Starter uses standard Workers AI billing and its daily free allocation by default.
Deployment owners can optionally enable Unified Billing for the gateway in Cloudflare to charge
Workers AI requests to prepaid AI Gateway credits and let third-party requests without a BYOK key
fall back to those credits. When the free allocation or AI Gateway credits are exhausted, SolZero
returns an actionable API error and displays links to the relevant Cloudflare documentation and AI
Gateway top-up page.
LiteLLM, MCP Context Forge, GitHub, Slack, AI Search, and external identity providers are optional.
Contributions for other integrations used by your organization are welcome.

## Tech Stack

- Cloudflare Workers, Durable Objects, Workflows, Containers, D1, KV, R2, and AI Search
- Effect for the backend API service
- TanStack Start and Kumo for the web app
- Better Auth for authentication
- Alchemy v2 for infrastructure as code
- Nub for package management

See [docs/system-diagram.md](docs/system-diagram.md) for the system architecture.

## Getting Started

### Prerequisites

- Node.js 24.15.x. The repository's `.nvmrc` and package metadata are the source of truth
- [Nub](https://nubjs.com/) 0.4.11
- A Docker-compatible CLI and running engine
- A Cloudflare account. Deploying this complete stack requires the Workers Paid plan because SolZero
  provisions Cloudflare Containers

### Local setup

Install Nub if needed, then install the locked dependencies:

```sh
curl -fsSL https://nubjs.com/install.sh | bash
nub install --frozen-lockfile
```

Create the ignored local environment files:

```sh
cp config/.env.example config/.env
cp config/.dev.vars.example config/.dev.vars
```

Set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in `config/.env`. The file is used by
infrastructure tooling and must remain untracked. `config/.dev.vars` contains only secret values
referenced by the dev profile.

The deployment token needs account `API Tokens > Write`, AI Gateway edit, and Secrets Store edit
permissions so Alchemy can create the scoped runtime token and BYOK resources, in addition to the
permissions needed to provision the rest of SolZero.

Update `config/dev.config.jsonc` before signing in:

1. Replace `admin@example.com` in `admins.adminEmails` with your email address.
2. Keep `deployment.zone` as `localhost` for local development.
3. Review the enabled Cloudflare AI Gateway model allowlist and default model.
4. Leave optional LiteLLM, MCP Context Forge, GitHub, Slack, and external auth blocks disabled until
   you intend to configure them.

Every stage has a complete, independent non-secret profile:
`config/dev.config.jsonc`, `config/test.config.jsonc`, `config/pre.config.jsonc`, and
`config/prod.config.jsonc`. An ephemeral `pre-*` stage uses the pre profile. Profiles are not merged.
Secret fields contain explicit environment references rather than secret values.

To provision a provider key in Cloudflare Secrets Store, uncomment its `providerKeys` reference in
the stage JSONC file and set the matching `S0_CONFIG_SECRETS_CF_AI_GATEWAY_*_API_KEY` value in the
stage vars file. A deployment reference locks that provider in Admin. Without a deployment
reference, an administrator can store an encrypted global key in Admin, and each user can
optionally override OpenAI, Anthropic, or xAI from Settings > AI Providers. Cloudflare resolves
credentials in this order: the per-request user or global Admin key, the gateway's default BYOK
key, then Unified Billing credits when that billing mode is enabled.

Validate the profiles:

```sh
nub run config:check
```

The default security keys and administrator password are marked `generateIfMissing`; Alchemy creates
and persists them when their entries in `config/.dev.vars` are omitted or empty. When you enable an
integration, uncomment and populate each secret it references in `config/.dev.vars`. SolZero fails before
startup with the missing environment variable name when a required secret is absent.

Confirm that the credentials resolve to the intended Cloudflare account, then start SolZero:

```sh
set -a
source config/.env
set +a
nub exec wrangler whoami
nub run dev
```

The web app runs at <http://localhost:3000> and the API Worker at
<http://localhost:1337>. In another terminal, verify the control plane and retrieve the generated
local administrator password:

```sh
curl --fail-with-body http://localhost:1337/health
nub run auth:admin-password -- dev --local
```

Sign in at <http://localhost:3000> with an email from `admins.adminEmails` and the retrieved
password. Create an Isolate, OpenCode, or Codex session with a compatible Cloudflare AI Gateway
model and send a prompt. Configure LiteLLM in Admin only if you want additional models. GitHub
linking is required only for repository-backed sessions.

### Deploy to Cloudflare

The production profile derives `https://ai.<zone>` for the web app and
`https://api.ai.<zone>` for the API unless `deployment.webFqdn` and `deployment.apiFqdn` override
them. Both hostnames must belong to the configured Cloudflare zone.

Prepare production configuration and secrets:

```sh
cp config/.dev.vars.example config/.prod.vars
```

1. Set `deployment.zone` in `config/prod.config.jsonc` to the Cloudflare-managed zone.
2. Optionally set explicit `deployment.webFqdn` and `deployment.apiFqdn` values.
3. Replace `admin@example.com` with the production administrator email.
4. Enable only the external integrations you are ready to configure.
5. Uncomment and populate the matching integration secrets in `config/.prod.vars`.

```sh
nub run config:check
```

Run the plan to review the resources to be created:

```sh
nub run infra:plan:prod
```

Deploy only after the plan targets the intended account, zone, and resource names:

```sh
nub run infra:deploy:prod
```

The first Container deployment can take several minutes to become ready even after the Workers are
available. Retrieve the generated administrator password and verify the public surfaces:

```sh
nub run auth:admin-password -- prod
curl --fail-with-body https://api.ai.<zone>/health
curl --fail-with-body https://ai.<zone>/api/auth/config
```

Open `https://ai.<zone>`, sign in with the configured administrator email, configure the model
gateway, and run the same Isolate-session smoke test used locally. Then test a Container runtime if
you intend to use OpenCode, Codex, or Claude Code.

For preview deployment, use the same sequence with `config/pre.config.jsonc`, `config/.pre.vars`,
`nub run infra:plan:pre`, and `nub run infra:deploy:pre`. The `dev`, `test`, `pre`, and `prod`
profiles are all validated intentionally; do not delete unused profiles without changing that
contract.

## Common commands

```sh
nub run dev                 # API Worker and web app
nub run dev:api             # API Worker only
nub run dev:web             # web app only
nub run config:check        # validate every config profile and generated schema
nub run test                # workspace and repository tests
nub run typecheck           # repository type checks
nub run lint                # repository lint checks
nub run format              # formatting check
```

Run the local API-key e2e test after creating a user API key:

```sh
S0_API_KEY="<user API key>" \
BACKGROUND_BASE_URL=http://localhost:1337 \
nub run test:e2e
```

## What's Next?

There is more work to do. Current areas of focus include:

- Dynamic Sites
- Teams
- Workflow evaluation support
- A public documentation site
- Code Mode fixes
- UI polish
- Dynamic container support based on Cloudflare Account plan

## License

Copyright (C) 2026 Consensys

This project is licensed under the GNU Lesser General Public License v3.0-only. See
[COPYING](COPYING), [COPYING.LESSER](COPYING.LESSER), and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
