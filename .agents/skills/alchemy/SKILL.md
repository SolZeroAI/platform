---
name: alchemy
description: Answers Alchemy (alchemy.run) questions from an indexed local copy of the full documentation. Covers Stacks, Resources, Actions, Outputs, bindings, the Effect-based deploy/runtime phase model, the alchemy CLI, state stores, stages, secret providers (dotenv, Doppler, Infisical), Better Auth, SQL clients (Effect SQL, Drizzle, Prisma ORM), and provider guides for Cloudflare, AWS, GCP, Kubernetes, Fly, Railway, Hetzner, Neon, PlanetScale, Prisma, Turso, Rivet, Stripe, Docker, and Axiom, sandbox providers (Modal, Daytona, E2B, Boat, Archil), Effect Cluster, and the Effect domain-driven design framework. Use when the user mentions "alchemy", "alchemy.run", "alchemy.run.ts", "Alchemy.Stack", "Infrastructure-as-Effects", "alchemy deploy", or asks how to define a Resource, bind a resource into a Worker or Lambda, or deploy an Effect program to Cloudflare or AWS with Alchemy.
argument-hint: "[topic]"
---

# alchemy documentation index

Answer the Alchemy question in `$ARGUMENTS` (or, if empty, the request that
triggered this skill) using the indexed corpus below. All paths are relative to
this skill's directory.

<!-- BEGIN GENERATED: corpus-stats -->

Indexed from `alchemy-run/alchemy` @ `21c6012` (2026-11-12), alchemy `2.0.0-beta.86` on `effect@4.1.4`: **807 topic files** across 37 areas.

Reference paths mirror site URLs exactly, so a path is derivable without
searching: `https://alchemy.run/cloudflare/compute/workers` ->
`references/cloudflare/compute/workers.md`. A section landing page is
`_overview.md` (`https://alchemy.run/cli` -> `references/cli/_overview.md`).

<!-- END GENERATED: corpus-stats -->

## Task

1. **Classify** the question against the routing tables below.
2. **Read** at most **1-3** topic files. Prefer one exact file over many.
3. **Answer** with concrete TypeScript, using exact symbol names.
4. **Cite** each reference file you used by path.

If _Core mental model_ or _Command surface_ already covers it, answer directly
and read nothing.

## Core mental model

- **`Alchemy.Stack(name, { providers, state }, effect)`** is the deploy unit.
  `providers` and `state` are both required; the `Effect.gen`'s return value is
  the stack output. It is `export default`ed. `alchemy.run.ts` is only the CLI's
  default lookup, so any file with a default-exported Stack works as `[file]`.
- **Resource.** The first constructor argument is the **logical ID** you choose.
  The physical name is derived as `{stack}-{stage}-{logicalId}-{instanceId}`.
  The instance ID is stable across create/update/delete and changes only on
  replacement, which is what makes creates idempotent. A resource declaration is
  **inert until a Stack `yield*`s it**, so declaring one at module scope and
  importing it deploys nothing.
- **`Output<T>`** is the lazy typed reference. Property access returns another
  Output (`bucket.bucketName` is `Output<string>`), and passing one into another
  resource's props is what registers the dependency edge that orders the deploy.
  Operators: `Output.all`, `` Output.interpolate`...` ``,
  `output.pipe(Output.map(fn))`, `Output.mapEffect`, `Output.literal`,
  `Output.fromEffect`, `Output.ref`. `Redacted<T>` survives evaluation and prints
  as `<redacted>`.
- **Bindings are the thing that makes v2 different from prop-passing IaC.**
  `yield* Cloudflare.R2.ReadWriteBucket(Bucket)` hands back a typed SDK client.
  There is no `env.BUCKET` and no hand-written IAM. A binding has two halves: the
  **contract** (a `Binding.Service`, a callable Context tag) and an
  interchangeable **implementation Layer** supplied with `Effect.provide`:
  `*Binding` (native platform binding), `*Http` (deploy-time scoped token plus
  HTTP at runtime), `*Local` (deploy-time client reusing the CLI's credentials,
  for use inside Actions). Same contract, same handler code. Bindings are also
  the only mechanism that expresses **circular references**; plain Output props
  form a DAG.
- **Providers** teach Alchemy a resource type and are Effect Layers:
  `Cloudflare.providers()`, `AWS.providers()`, `Layer.mergeAll(...)`. Declaring a
  resource whose provider layer is missing is a **type error**.
- **Lifecycle:** Diff, Read, Pre-Create, Reconcile (used for both create and
  update), Delete (must be idempotent). On a resource with no prior state the
  engine calls `read`: `undefined` means create, plain attrs means silent adopt
  (state recovery), `Unowned(attrs)` fails unless `--adopt`.
- **Actions** are graph nodes with no provider lifecycle: no replace, read, or
  delete. Only run (`λ`) or skip (`·`), decided by a SHA-256 of the resolved
  input against the persisted `inputHash`. `deploy --force` flips every skip to
  run. Use them for seeding, migrations, and cache invalidation.
- **State** persists by FQN, scoped by stack name and stage:
  `Alchemy.localState()` (`.alchemy/` on disk), `Cloudflare.state()` (Worker plus
  Durable Object), `AWS.state()` (S3). **Stage** is an isolated instance of a
  Stack (default `dev_$USER`) with its own state and physical names.

### The two phases

Function-shaped resources (Worker, Lambda, Durable Object, Workflow, Container,
ECS Task, Fly/Railway/Hetzner Service) express both phases in one program by
returning an Effect from inside an Effect:

- The **outer `Effect.gen` is the init phase.** It runs at plantime to discover
  and record bindings, and _again at cold start_ inside the deployed handler,
  where the same calls return live SDK clients. Bind what you need, return what
  you expose.
- The **returned handlers are the runtime phase** (`fetch` plus any RPC methods),
  running per request and never at plantime.
- `Alchemy.RuntimeContext` exists only in the runtime closure. Requiring it
  outside a handler is a compile error.
- `ALCHEMY_PHASE` is `plan` or `runtime`. `alchemy dev` is a **plantime** phase,
  so read the `ALCHEMY_DEV` config key to detect dev specifically.
- Two lifetimes: instance scope (once per isolate) and request scope (per event).
  **Build at instance scope, acquire at request scope**, because instance
  finalizers never run on workerd.

Effect style is optional. **Async style** keeps a plain `async fetch(request,
env)` handler, declares bindings on the resource's `env` prop, and types `env`
with `Cloudflare.InferEnv<typeof Worker>`. Both styles share providers, CLI, and
artifact.

## Canonical shapes

```typescript
// alchemy.run.ts
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

export default Alchemy.Stack(
  "MyApp",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const bucket = yield* Cloudflare.R2.Bucket("Bucket");
    return { bucketName: bucket.bucketName };
  }),
);
```

```typescript
// src/worker.ts -- init phase binds, runtime phase serves
export default Cloudflare.Worker(
  "Api",
  { main: import.meta.url },
  Effect.gen(function* () {
    const bucket = yield* Cloudflare.R2.ReadWriteBucket(Bucket);
    return {
      fetch: Effect.gen(function* () {
        const obj = yield* bucket.get("hello.txt");
        return obj
          ? HttpServerResponse.text(yield* obj.text())
          : HttpServerResponse.text("Not found", { status: 404 });
      }),
    };
  }).pipe(Effect.provide(Cloudflare.R2.ReadWriteBucketBinding)),
);
```

The class form adds RPC methods and a nominal type; the `<Greeter>` self
reference and the empty `()` are required ceremony:

```typescript
export default class Greeter extends Cloudflare.Worker<Greeter>()(
  "Greeter",
  { main: import.meta.url },
  Effect.gen(function* () {
    return { greet: (name: string) => Effect.succeed(`hello ${name}`) };
  }),
) {}
```

## Command surface

`bun alchemy <command> [options]`. The stack file defaults to `alchemy.run.ts`
and must exist. Pass another with `--config`/`-c <file>`, or positionally as
`[file]` on `deploy`, `plan`, `destroy`, `dev`, and `unsafe nuke` only. Stack
commands take `--stage`, `--profile`, and `--env-file`. `--yes`/`-y` exists only
where a command asks for approval (`deploy`, `destroy`, `unsafe nuke`,
`provider aws teardown`, `provider cloudflare token`); `plan`, `dev`, `logs`, and
`drift` reject it. The global `--no-input` disables prompts and the TUI.

| Command                                                                | Purpose                                                                                 | Flags that matter                                                              |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `deploy [file]`                                                        | plan, approve, apply                                                                    | `--dry-run`, `--force`, `--adopt`, `--yes`                                     |
| `plan [file]`                                                          | preview only; same code path as `deploy --dry-run`                                      | `--stage`, `--detailed`, `--adopt`                                             |
| `destroy [file]`                                                       | delete this stack and stage in dependency order                                         | `--dry-run`, `--yes`                                                           |
| `drift`                                                                | re-observe the cloud and report drift; asks before repairing unless `--repair`          | `--repair` (repairs without asking; there is no `--yes`)                       |
| `unsafe nuke [file]`                                                   | delete everything each provider's `list()` returns                                      | `--dry-run`, `--include`, `--exclude`, `--filter`, `--local`                   |
| `dev [file]`                                                           | hot-reloading loop; implies `--yes` and dev mode                                        | `--force`                                                                      |
| `logs`                                                                 | fetch past log entries, or stream live with `--tail`                                    | `--resource`/`-r <ids>`, `--tail`/`-t`, `--limit`, `--since`                   |
| `profile [create\|rename\|edit\|refresh\|current\|list\|show\|delete]` | manage credentials in `~/.alchemy/profiles.json`; bare `profile` opens the dashboard    | `--add`, `--reconfigure`, `--remove` (on `edit`)                               |
| `state [list\|read\|delete]`                                           | inspect and manage state (aliases `ls`/`cat`/`rm`); bare `state` opens the explorer     | `--backend <configured\|local>`, `--recursive`/`-r`                            |
| `provider check-env`                                                   | CI preflight: verify the stack's provider env vars are set (exits 1 if any are missing) | `--provider`                                                                   |
| `provider aws bootstrap\|teardown`                                     | per-account assets bucket that Lambda needs                                             | `--aws-profile`, `--region`, `--yes` (teardown only)                           |
| `provider cloudflare bootstrap\|teardown\|token\|state logs`           | state-store worker, API tokens, its logs                                                | `--force` (bootstrap), `--all-permissions` (token), `--tail`/`-t` (state logs) |

Plan symbols: `+` create, `~` update, `±` replace, `-` delete, `•` no-op, `λ`
action run, `·` action skip.

`deploy`, `destroy`, and `plan` render an Ink TUI interactively. A known agent
env var (including `CLAUDECODE`) forces plain output, and **plain mode never
prompts and makes no changes**, so always pass `--yes` when running these
yourself.

## Routing

<!-- BEGIN GENERATED: routing -->

### Start here

- `references/getting-started.md` -- Install Alchemy and create your first Stack in under two minutes.
- `references/migrating-from-v1.md` -- Migrate your Alchemy v1 (async/await) project to Alchemy v2.
- `references/what-is-alchemy.md` -- Alchemy is a TypeScript framework for building cloud applications with Effects and Layers. Your infrastructure and the code that runs on it are written, type-checked, and deployed together.

### Areas

- `references/acme/` (9) -- Manage TLS certificates independently of your hosting provider, at deploy time or from an application.
- `references/apis/` (4) -- Every Function and Server returns { fetch, ...rpcs } — schemaless typed calls are the default for internal communication; Effect RPC and Effect HTTP add schemas where data crosses a trust boundary.
- `references/archil/` (20) -- Run commands, processes and programs serverlessly against durable disks, in Firecracker microVMs, with Alchemy. Declare disks, sandboxes, images and branches in TypeScript.
- `references/aws/` (62) -- Build on AWS with Alchemy. Declare Lambda Functions, containers, tables, buckets and queues in TypeScript, and let bindings write each runtime's IAM policy from the calls its code makes.
- `references/axiom/` (8) -- Observability as resources — OTEL datasets, ingest tokens, monitors, notifiers, and dashboards declared next to the code that emits the data.
- `references/better-auth/` (29) -- Build authentication with an Effect service, automatic database bindings, and deploy-time migrations.
- `references/boat/` (19) -- Run sandboxes on Boat with Alchemy. Declare sandboxes, snapshots, environments and webhooks in TypeScript, and create sandboxes from any Worker or Function.
- `references/cli/` (15) -- Every alchemy command at a glance — the command map, common options, and how the interactive TUI decides when to render.
- `references/cloudflare/` (87) -- Build on Cloudflare with Alchemy. Declare Workers, Durable Objects, R2, D1, KV and Queues in TypeScript, and bind each one into the Worker that uses it with a typed client.
- `references/cluster/` (23) -- Run Effect Cluster entities, workflows, singletons and crons with Alchemy — a Postgres database and a pool of runners on Docker, AWS, GCP, Kubernetes, Fly or Hetzner, or Durable Objects on Cloudflare.
- `references/command/` (4) -- Alchemy's cloud-agnostic primitives for local processes in the deploy graph — memoized builds, one-off commands, and dev servers.
- `references/daytona/` (20) -- Run code you don't fully trust in Daytona sandboxes. Declare snapshots, volumes and secrets in your Stack, and create, drive and delete sandboxes from any Worker or Lambda.
- `references/docker/` (17) -- Docker builds applications into images and runs them as isolated containers on a Docker engine, on your laptop, a CI runner or a server.
- `references/domain/` (44) -- A domain-driven design framework for Effect. Model your business as commands, aggregates, events, views, projections and policies, test it in memory, and run it on Durable Objects on Cloudflare, Rivet or Effect Cluster.
- `references/e2b/` (17) -- Run sandboxes for agents on E2B with Alchemy. Declare templates, warm snapshots, volumes and secrets in TypeScript, and create sandboxes from any Worker or Function.
- `references/environments/` (11) -- Stages, per-environment config, secrets, local dev, and CI.
- `references/fly/` (38) -- Run Effect programs on Fly.io with Alchemy. Declare Services, Machines, Volumes, Postgres, Redis and Tigris in TypeScript, in the regions near your users.
- `references/gcp/` (51) -- Build on Google Cloud with Alchemy. Declare Cloud Run services, jobs, Firestore, Cloud Storage and Pub/Sub in TypeScript, and let bindings grant each runtime's service account the roles its code uses.
- `references/git/` (26) -- A pluggable, embeddable, self-hostable git server on Cloudflare Workers, Durable Objects, and R2. Smart HTTP for any client, a typed REST plane with pull requests, and a GitHub-compatible API.
- `references/github/` (7) -- Repositories, Actions secrets, variables and environments, webhooks, repository event sources and pull request comments as Stack resources — the glue for CI/CD.
- `references/hetzner/` (29) -- Run Effect programs on Hetzner Cloud Servers with Alchemy. Declare Servers, Services, Volumes, networks, firewalls, load balancers and DNS in one TypeScript program.
- `references/infrastructure-as-code/` (12) -- The noun graph: Stacks, Resources, Actions, Outputs, references, lifecycle, providers.
- `references/infrastructure-as-effects/` (10) -- One Effect program models runtime code and infrastructure: Runtimes carry code, Bindings wire resources into them, Phases split deploy from runtime, and Layers package it behind typed services.
- `references/kubernetes/` (20) -- Run containers and Effect programs on any Kubernetes cluster with Alchemy. Declare Deployments, Jobs, raw manifests, and Helm charts in the same typed program as the rest of your infrastructure. No YAML, no kubectl apply.
- `references/modal/` (28) -- Run Functions, Servers and Sandboxes on Modal with Alchemy. Declare apps, images, volumes and secrets in TypeScript, and create sandboxes from any Worker or Lambda.
- `references/neon/` (36) -- Declare Neon Postgres projects, branches and roles, plus Functions, storage, Auth, the Data API and AI Gateway, in an Alchemy Stack, with a branch per preview stage.
- `references/planetscale/` (11) -- Declare PlanetScale Postgres and MySQL databases, branches and credentials in your Stack with Alchemy, apply migrations on deploy, and give every preview stage its own branch.
- `references/prisma/` (31) -- Declare Prisma Postgres databases, connections, branches and Compute apps as Stack resources with Alchemy, and run the same Stack against a local Postgres in dev.
- `references/project-structure/` (4) -- How to lay out single-stack and multi-stack repos.
- `references/railway/` (38) -- Run Effect programs on Railway with Alchemy. Declare Projects, Services, Functions, Postgres, MySQL, Redis, Volumes and Buckets in one TypeScript program.
- `references/rivet/` (29) -- Build on Rivet with Alchemy. Declare Durable Objects and Durable Streams in TypeScript, run the control plane and its nodes on the cloud you choose or on Rivet Cloud, and call any instance by name from any runtime.
- `references/sql/` (17) -- Choose a database, connect with Effect SQL, Drizzle, or Prisma ORM, and deploy committed migrations.
- `references/state-store/` (2) -- How Alchemy persists resource state between deploys to compute diffs and track infrastructure.
- `references/stripe/` (7) -- Sell subscriptions and onboard merchants from a Cloudflare Worker — catalog, Checkout, the Billing Portal, Connect, and webhooks declared next to the code that uses them.
- `references/testing/` (5) -- How Alchemy tests work — real clouds by default, local emulators on demand, one Stack deploy per suite, isolated stages, deploy → assert → destroy.
- `references/turso/` (14) -- Create Turso SQLite databases and query them from your Workers.

Each area has an `INDEX.md` listing every page with what it covers. Read
it only to disambiguate; read the topic file to answer.

### Page map

Every page in the corpus. Append `.md` and prefix `references/<area>/`.

```
acme/                      _overview certificate-authorities dns-validation
                           getting-started renewal runtime troubleshooting
                           using-certificates what-is-acme
apis/                      _overview effect-http effect-rpc schemaless
archil/                    _overview compute/choosing-a-runtime compute/images
                           compute/programs compute/sandboxes organization-and-keys
                           security/credentials security/network setup storage/branches
                           storage/disks storage/mounting storage/your-own-bucket
                           tutorial/part-1 tutorial/part-2 tutorial/part-3
                           tutorial/part-4 tutorial/part-5 tutorial/part-6
                           what-is-archil
aws/                       _overview accounts-and-regions ai/bedrock apis/api-gateway
                           apis/effect-http-api apis/effect-rpc apis/schemaless-rpc
                           compute/choosing-a-runtime compute/ec2 compute/ecs-sandboxes
                           compute/ecs compute/effect-workflows compute/eks
                           compute/hyperpod compute/lambda compute/microvms
                           compute/nitro-sandboxes compute/web-functions
                           data/drizzle-aurora data/drizzle-dsql data/dynamodb data/rds
                           data/s3 email/receiving email/sending frontend/astro
                           frontend/foldkit frontend/full-stack-tanstack-rpc-drizzle
                           frontend/nextjs frontend/nuxt frontend/octane
                           frontend/react-router frontend/solidstart
                           frontend/static-site frontend/sveltekit
                           frontend/tanstack-start frontend/vinext frontend/vite-spa
                           frontend/vite frontend/vue frontend/waku frontend/websites
                           iam local-development messaging/dynamodb-streams
                           messaging/eventbridge messaging/kinesis messaging/s3-events
                           messaging/sns messaging/sqs networking/_overview
                           networking/custom-domains observability/cloudwatch
                           security/federated-identity security/secrets-env setup
                           tutorial/part-1 tutorial/part-2 tutorial/part-3
                           tutorial/part-4 tutorial/part-5 what-is-aws
axiom/                     _overview data/ingest guides/alerting guides/annotations
                           guides/dashboards organizations-and-tokens setup
                           what-is-axiom
better-auth/               _overview databases/_overview databases/aurora-data-api
                           databases/cloudflare-d1 databases/cloudflare-hyperdrive
                           databases/drizzle databases/memory databases/mysql
                           databases/neon databases/postgres databases/sqlite
                           guides/configuration guides/http-api-middleware
                           guides/migrations guides/secondary-storage
                           sign-in-providers/_overview sign-in-providers/custom-oauth
                           sign-in-providers/email-password sign-in-providers/github
                           sign-in-providers/google sign-in-providers/microsoft
                           tutorial/part-1 tutorial/part-2 tutorial/part-3
                           tutorial/part-4 tutorial/part-5 tutorial/part-6
                           upgrades/from-1-6-to-1-7 what-is-better-auth
boat/                      _overview account-and-keys sandboxes/choosing-a-runtime
                           sandboxes/lifecycle-events sandboxes/ports sandboxes/programs
                           sandboxes/sandboxes sandboxes/snapshots
                           security/credential-profiles security/credentials
                           security/environments setup tutorial/part-1 tutorial/part-2
                           tutorial/part-3 tutorial/part-4 tutorial/part-5
                           tutorial/part-6 what-is-boat
cli/                       _overview adopting-resources api aws cloudflare deploy
                           destroy dev drift inspecting-state logs nuke plan profile
                           state
cloudflare/                _overview accounts-and-tokens ai/ai-gateway ai/ai-search
                           ai/effect-ai ai/vectorize ai/workers-ai apis/effect-http-api
                           apis/effect-rpc apis/schemaless-rpc compute/add-a-workflow
                           compute/browser-rendering compute/cache compute/code-updates
                           compute/container-lifecycle compute/containers
                           compute/cross-worker-durable-object compute/durable-objects
                           compute/effect-workflows compute/gradual-deployments
                           compute/hibernatable-websockets compute/previews
                           compute/python-workers compute/rate-limiting
                           compute/run-a-container compute/worker-loader
                           compute/workers-for-platforms compute/workers
                           compute/workflows data/artifacts
                           data/branch-from-shared-database data/d1-drizzle data/d1
                           data/drizzle data/hyperdrive-private-database data/hyperdrive
                           data/iceberg-tables data/kv data/pipelines data/prisma
                           data/r2-presigned-urls data/r2 data/shared-database
                           email/_overview email/email-worker email/send-and-receive
                           frontend/astro frontend/foldkit frontend/frontends
                           frontend/full-stack-tanstack-rpc-drizzle frontend/nextjs
                           frontend/nuxt frontend/octane frontend/react-router
                           frontend/solidstart frontend/static-site frontend/sveltekit
                           frontend/tanstack-start frontend/vinext frontend/vite-spa
                           frontend/vite frontend/vue frontend/waku local-development
                           messaging/cron messaging/github-events messaging/k2
                           messaging/queues networking/custom-domains networking/domains
                           networking/federated-apis networking/tunnel
                           observability/analytics-engine
                           observability/axiom-observability
                           observability/workers-tracing security/access
                           security/secrets-env security/secrets-store
                           security/turnstile setup tutorial/part-1 tutorial/part-2
                           tutorial/part-3 tutorial/part-4 tutorial/part-5
                           tutorial/part-6 what-is-cloudflare
cluster/                   _overview aws calling cloudflare crons databases docker
                           entities existing-programs fly gcp hetzner kubernetes
                           middleware pools setup singletons tutorial/part-1
                           tutorial/part-2 tutorial/part-3 tutorial/part-4
                           what-is-effect-cluster workflows
command/                   _overview dev-servers memoization what-is-command
daytona/                   _overview networking/network observability/telemetry
                           organization/organization organizations-and-keys
                           sandboxes/programs sandboxes/runners sandboxes/sandboxes
                           sandboxes/snapshots sandboxes/toolbox sandboxes/volumes
                           security/secrets setup tutorial/part-1 tutorial/part-2
                           tutorial/part-3 tutorial/part-4 tutorial/part-5
                           tutorial/part-6 what-is-daytona
docker/                    _overview build-caches build-images cloud-runtimes containers
                           effectful-services engines-and-contexts limits-and-security
                           local-services networks registries remote-images services
                           setup swarm volumes what-is-docker
domain/                    _overview aggregate annotations api backfill better-auth cli
                           cloudflare command deadlines effect-cluster event
                           external-system foldkit http-api in-memory local-first mcp
                           model observability optimistic-updates policy project-layout
                           projection query rivet saga sessions story stream
                           testing-apis testing-models tutorial/part-1 tutorial/part-2
                           tutorial/part-3 tutorial/part-4 tutorial/part-5
                           tutorial/part-6 tutorial/part-7 tutorial/part-8 unique-values
                           view-security view what-is-ddd
e2b/                       _overview api-keys lifecycle-events network-and-secrets
                           programs sandboxes setup snapshots templates tutorial/part-1
                           tutorial/part-2 tutorial/part-3 tutorial/part-4
                           tutorial/part-5 tutorial/part-6 volumes what-is-e2b
environments/              auth-providers ci custom-auth-provider doppler infisical
                           local-development profiles secret-providers secrets stages
                           worktrees
fly/                       _overview compute/apps compute/connecting-services
                           compute/deployments compute/machines compute/regions
                           compute/services compute/sprites data/drizzle-postgres
                           data/postgres data/redis data/secrets data/tigris
                           data/volumes federated-identity frontend/astro
                           frontend/foldkit frontend/nextjs frontend/nuxt
                           frontend/octane frontend/react-router frontend/solidstart
                           frontend/static-site frontend/sveltekit
                           frontend/tanstack-start frontend/vinext frontend/vite
                           frontend/vocs frontend/waku frontend/websites networking
                           organizations-and-tokens setup tutorial/part-1
                           tutorial/part-2 tutorial/part-3 tutorial/part-4 what-is-fly
gcp/                       _overview ai/vertex-ai apis/effect-http-api apis/effect-rpc
                           compute/choosing-a-runtime compute/cloud-functions
                           compute/cloud-run compute/gke compute/jobs compute/sidecars
                           compute/worker-pools data/bigquery data/cloud-sql
                           data/firestore data/memorystore data/storage frontend/astro
                           frontend/foldkit frontend/nextjs frontend/nuxt
                           frontend/octane frontend/react-router frontend/solidstart
                           frontend/static-site frontend/sveltekit
                           frontend/tanstack-start frontend/vinext frontend/vite-spa
                           frontend/vite frontend/vocs frontend/vue frontend/waku
                           frontend/websites messaging/eventarc messaging/pubsub
                           messaging/scheduler messaging/storage-events
                           networking/private-services networking/vpc
                           observability/monitoring projects-and-regions
                           security/federated-identity security/iam security/secrets-kms
                           setup tutorial/part-1 tutorial/part-2 tutorial/part-3
                           tutorial/part-4 tutorial/part-5 what-is-gcp
git/                       _overview blocks/_overview blocks/auth blocks/blob-store
                           blocks/engine blocks/hasher blocks/registry
                           blocks/repositories blocks/server clone-and-push
                           getting-started github-api pull-requests recipes/_overview
                           recipes/cloudflare-aws recipes/cloudflare recipes/scaling
                           recipes/your-own-store repositories tutorial/part-1
                           tutorial/part-2 tutorial/part-3 tutorial/part-4
                           tutorial/part-5 tutorial/part-6 what-is-git
github/                    _overview accounts-and-tokens actions-config events
                           repository setup what-is-github
hetzner/                   _overview compute/servers compute/services
                           data/drizzle-postgres data/volumes frontend/astro
                           frontend/foldkit frontend/nextjs frontend/nuxt
                           frontend/octane frontend/react-router frontend/solidstart
                           frontend/static-site frontend/sveltekit
                           frontend/tanstack-start frontend/vinext frontend/vite
                           frontend/vocs frontend/waku frontend/websites
                           networking/_overview networking/dns projects-and-tokens setup
                           tutorial/part-1 tutorial/part-2 tutorial/part-3
                           tutorial/part-4 what-is-hetzner
infrastructure-as-code/    action contributions custom-provider dns-adapters
                           local-provider outputs provider references renaming
                           resource-lifecycle resource stack
infrastructure-as-effects/ binding circular-bindings custom-runtime event-sources
                           identity-federation layers phases runtime sinks telemetry
kubernetes/                _overview clusters/cluster-adapters clusters/connecting
                           clusters/eks clusters/local clusters/registries
                           objects/helm-charts objects/manifests setup tutorial/part-1
                           tutorial/part-2 tutorial/part-3 tutorial/part-4
                           tutorial/part-5 what-is-kubernetes workloads/bindings
                           workloads/deployments workloads/images workloads/jobs
                           workloads/object-lifecycle
modal/                     _overview compute/choosing-a-runtime networking/network
                           sandboxes/images sandboxes/persistent sandboxes/programs
                           sandboxes/sandboxes sandboxes/snapshots
                           security/access-control security/secrets services/autoscaling
                           services/calling-python services/functions services/operating
                           services/servers services/web-endpoints setup storage/dicts
                           storage/queues storage/volumes tutorial/part-1
                           tutorial/part-2 tutorial/part-3 tutorial/part-4
                           tutorial/part-5 tutorial/part-6 what-is-modal
                           workspaces-and-tokens
neon/                      _overview data/branching data/connections data/migrations
                           data/roles frontend/astro frontend/foldkit frontend/nextjs
                           frontend/nuxt frontend/octane frontend/react-router
                           frontend/solidstart frontend/static-site frontend/sveltekit
                           frontend/tanstack-start frontend/vite frontend/vocs
                           frontend/waku functions governance guides/ai-gateway
                           guides/custom-domains guides/drizzle guides/preview-branches
                           guides/private-networking guides/production-auth
                           guides/state-recovery organizations-and-keys setup storage
                           tutorial/_overview tutorial/backend tutorial/frontend
                           tutorial/functions tutorial/previews what-is-neon
planetscale/               _overview data/backups data/credentials data/migrations
                           data/mysql data/postgres guides/drizzle
                           guides/preview-branches organizations-and-tokens setup
                           what-is-planetscale
prisma/                    _overview compute/apps compute/deployments data/branches
                           data/buckets data/connections data/drizzle-postgres
                           data/postgres frontend/astro frontend/foldkit frontend/nextjs
                           frontend/nuxt frontend/octane frontend/react-router
                           frontend/solidstart frontend/static-site frontend/sveltekit
                           frontend/tanstack-start frontend/vinext frontend/vite
                           frontend/vocs frontend/waku frontend/websites
                           guides/cloudflare-workers setup tutorial/part-1
                           tutorial/part-2 tutorial/part-3 tutorial/part-4
                           what-is-prisma workspaces-and-tokens
project-structure/         file-layout monorepo-multi-stack monorepo-single-stack
                           monorepo
railway/                   _overview compute/environments compute/functions
                           compute/projects compute/regions compute/services
                           data/buckets data/drizzle-mysql data/drizzle-postgres
                           data/mongo data/mysql data/postgres data/redis data/variables
                           data/volumes frontend/astro frontend/foldkit frontend/nextjs
                           frontend/nuxt frontend/octane frontend/react-router
                           frontend/solidstart frontend/static-site frontend/sveltekit
                           frontend/tanstack-start frontend/vinext frontend/vite
                           frontend/vocs frontend/waku frontend/websites networking
                           setup tutorial/part-1 tutorial/part-2 tutorial/part-3
                           tutorial/part-4 what-is-railway workspaces-and-tokens
rivet/                     _overview actors aws calling concurrency control-planes
                           docker durable-objects durable-streams fly gcp hetzner
                           kubernetes namespaces pools railway rivet-cloud
                           rivetkit-effect rivetkit-rust rivetkit secrets setup storage
                           tokens-and-networks tutorial/part-1 tutorial/part-2
                           tutorial/part-3 tutorial/part-4 what-is-rivet
sql/                       _overview databases drizzle/d1 drizzle/libsql
                           drizzle/migrations drizzle/mysql drizzle/postgres
                           effect-sql/d1 effect-sql/libsql effect-sql/lifecycle
                           effect-sql/migrations effect-sql/mysql effect-sql/postgres
                           prisma/contracts prisma/migrations prisma/postgres
                           what-is-sql
state-store/               _overview custom-state-store
stripe/                    _overview accounts-and-keys guides/connect
                           guides/subscriptions guides/webhooks setup what-is-stripe
testing/                   _overview observability test-harness testing-a-stack
                           testing-providers
turso/                     _overview connections database-per-tenant databases groups
                           migrations organization preview-databases setup tokens
                           tutorial/part-1 tutorial/part-2 tutorial/part-3 what-is-turso
```

<!-- END GENERATED: routing -->

### Routing judgment

**Compute target.** Cloudflare Worker is the documented default for that hub;
Durable Objects for globally-unique stateful instances and WebSockets,
Containers for long-lived or arbitrary runtimes, Workflows for durable
checkpointed jobs. On AWS, "choose Lambda unless you have a specific reason not
to"; ECS when the workload is long-running, exceeds 15 minutes, or is already a
container; EKS only when you want Kubernetes itself; EC2 when you need the
machine. Fly, Railway, and Hetzner all bundle an Effect program as a Service,
with no Dockerfile.

**SQL and databases.** `sql/effect-sql/*` for tagged-template SQL with typed
errors and no ORM; `sql/drizzle/*` for a typed schema and relational queries
(both wrap the same `@effect/sql` drivers); `sql/prisma/*` for Prisma ORM v8
contracts, Postgres 17+ only. Prisma ORM is separate from the `prisma/` hosting
provider (Prisma Postgres and Prisma Compute). `sql/databases.md` compares
engines, and `sql/_overview.md` maps each runtime plus database plus client
combination to its guide. For the store itself: D1 when SQLite is enough,
Neon for Postgres with copy-on-write branching per preview stage, PlanetScale for
branch-per-PR on Vitess MySQL or managed Postgres, RDS/Aurora when already on
AWS. **Hyperdrive is the pooler, not the database**: Neon, PlanetScale, or RDS
goes behind it.

**API modality.** `apis/schemaless` is the default for anything internal (Worker
to Worker, Worker to Durable Object); the client type _is_ the class you bound,
with no schema and no runtime validation. Use `apis/effect-rpc` when data crosses
a trust boundary and the consumer is Effect/TypeScript, and `apis/effect-http`
when the consumer is neither and wants real URLs and `curl`. The docs explicitly
discourage the schema'd modalities for internal calls.

**Pages whose filename does not give them away:**

- runtime constructors and Worker/Lambda walkthroughs ->
  `references/infrastructure-as-effects/runtime.md`; binding contracts and
  implementations -> `references/infrastructure-as-effects/binding.md`
- env vars and secrets -> `references/environments/secrets.md` (the
  `effect/Config` integration), then `<cloud>/security/secrets-env.md`
- where `Config` values come from (the Stack's `secrets` field: dotenv, process
  env, Doppler, Infisical, and their precedence) ->
  `references/environments/secret-providers.md`
- credentials rather than secrets -> `references/environments/profiles.md`.
  Profiles control _how alchemy authenticates_; stages control _what is deployed_
- local dev -> `references/environments/local-development.md`, then
  `references/<cloud>/local-development.md`
- CI and PR previews -> `references/environments/ci.md`
- cross-stack wiring -> `references/infrastructure-as-code/references.md`
- renaming without replacing -> `references/infrastructure-as-code/renaming.md`
- taking over existing infrastructure -> `references/cli/adopting-resources.md`
- deploy-time scripts -> `references/infrastructure-as-code/action.md`
- a new cloud or third-party API ->
  `references/infrastructure-as-code/custom-provider.md`

### Per-resource API reference

The corpus has no page for most individual resources. The generated reference is
not in the repo, but it is served as raw markdown:

```
https://alchemy.run/providers/<cloud>/<service>/<resource>.md
```

for example `/providers/cloudflare/r2/bucket.md`. Fetch that for exact props on a
resource the corpus only mentions in passing. Never invent option keys for one
from the conceptual pages.

## Traps

- **Resolving a `Config` only inside `fetch` binds nothing.** Bindings are
  discovered by running the init phase, and `fetch` never runs at deploy time.
  Resolve `Config` in the outer `Effect.gen`. The docs label this a footgun.
- **Changing a logical ID silently plans a replacement**, deleting the old
  physical resource and its data. Use `Alchemy.renamedFrom("OldId")`, listing
  former IDs most recent first.
- **v1 to v2 is not state-compatible.** v2 starts from an empty state store, so
  the first deploy creates duplicates. Pin `name` to v1's derived
  `{app}-{id}-{stage}` and run `deploy --adopt`. Then never run `destroy` in the
  v1 project, since its state still points at the same physical resources.
  Renames: `entrypoint` -> `main`, `bindings` -> `env`, `await` -> `yield*`.
- **`main: import.meta.url` vs `main: "./src/worker.ts"`** is the Effect vs async
  fork. `import.meta.url` means "this file is its own entrypoint". Omitting
  `main` deploys an assets-only Worker.
- **Acquiring a disposable at instance scope leaks**, because workerd isolates
  are evicted with no teardown hook. Acquire per event.
- **A binding Layer the host cannot satisfy is a compile error**, such as
  `Cloudflare.R2.ReadWriteBucketBinding` on an `AWS.Lambda.Function`.
- **`alchemy unsafe nuke` is not scoped to a stack, a stage, or the state
  store.** It deletes everything each registered provider's `list()` returns in
  the ambient account, including resources Alchemy never created. It is hidden
  from `--help` specifically so agents do not discover it. Do not suggest it
  casually. `--filter` **spares** on truthy.
- **`retain` protects from Alchemy, not from the provider's cascade**, and must
  be set before the deploy that would remove the resource.
- **Moving a resource between local and live is a replacement**, not an update.
- **References fail fast.** Deploy the owner stage first, destroy in reverse.
- **Actions are not idempotent for free**; the body must tolerate retries.
- **R2 refuses to delete a non-empty bucket** unless `forceDestroy: true`.

## Version notes

Alchemy v2 is **pre-release** and moving fast. It builds against the exact
stable Effect 4 release named in the corpus stats above (peer range `^4.1.4`
for `effect`, `@effect/platform-bun`, and `@effect/platform-node`, installed
from the npm `latest` dist-tag, not `effect@rc`); the `effect-ts` skill
documents that same version, so use it for Effect APIs. Unstable modules import
without an `unstable` segment (for example `effect/http/HttpServerResponse` and
`effect/http-api/HttpApi`); rewrite any older `effect/unstable/...` or
`effect/httpapi/...` import. Drizzle is pinned to an exact prerelease
(`drizzle-orm@1.0.0-rc.5`); do not suggest `drizzle-orm@latest`.
Prisma ORM v8 is also a release candidate (`prisma@8.0.0-rc.*`). Better Auth is
on the 1.7 line. Node floor is 22+ (the upstream repo develops on Node 24), Bun
recommended.

The stage resolution chain is documented inconsistently: prefer
`references/environments/stages.md` over `references/cli/_overview.md`, and treat
the exact stage-name regex as unsettled.

## Rules

- The corpus is a point-in-time snapshot of a beta. If it does not cover
  something, say so plainly rather than inventing an API.
- Symbol names are exact and case-sensitive. Quote them verbatim; never guess an
  export that is not in the file you read.
- Read the specific topic file, not an `INDEX.md`, once routing is clear.
  `INDEX.md` files are for disambiguation only.
- Each reference file's header carries its upstream URL. Cite that when pointing
  the user at official docs.
- Release notes are deliberately not indexed. For "when did X change", point at
  https://alchemy.run/blog.
- Refresh the corpus from upstream: `bun $SKILL_DIR/scripts/build-skill.ts`
  (`--check` to verify freshness, `--ref <sha>` to pin).

## Output

Lead with the TypeScript that answers the question, then explain the symbols
used, then list the reference file paths consulted.
