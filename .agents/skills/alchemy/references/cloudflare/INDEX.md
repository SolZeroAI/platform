# cloudflare index

78 pages. Build and deploy full applications on Cloudflare with Alchemy — one Worker runtime plus resources like Durable Objects, D1, R2, Queues, and Hyperdrive, wired together by typed bindings.

| Page | File | Covers |
| --- | --- | --- |
| Cloudflare | `_overview.md` | Build and deploy full applications on Cloudflare with Alchemy — one Worker runtime plus resources like Durable Objects, D1, R2, Queues, and Hyperdrive, wired together by typed bindings. |
| Local development | `local-development.md` | alchemy dev runs Workers in workerd with local simulators for KV, R2, D1, Queues, Hyperdrive, Workflows, Containers, and the Worker binding surface — browser rendering, images, email, cron, Stream, and more. |
| Setup | `setup.md` | Install Alchemy, create a Cloudflare account, and connect the two — OAuth or API token, saved to a local profile. No environment variables required. |

## ai/

| Page | File | Covers |
| --- | --- | --- |
| Add an AI Gateway | `ai/ai-gateway.md` | Wire an AI Gateway into your Worker, turn it into a typed Effect LanguageModel, and run generations and streams through Workers AI with caching, rate limiting, and logs. |
| Add AI Search (AutoRAG) | `ai/ai-search.md` | Stand up a Cloudflare AI Search (AutoRAG) pipeline over an R2 bucket with one Search call, bind it into your Worker as a typed Effect client, and answer questions over your own documents. |
| Effect AI | `ai/effect-ai.md` | Wire Effect's LanguageModel and Chat services into a Cloudflare Worker — read API keys with effect/Config, provide the model layer to your handler, plug in persistence. |
| Build a release-automation agent | `ai/release-agent.md` | Case study of the cloudflare-agent example — GitHub push events routed through a Worker to a per-release Durable Object that drives an AI agent with container-backed tools. |
| Vector search with Vectorize | `ai/vectorize.md` | Create a Vectorize index, bind it to a Worker with SearchIndex, and run filtered nearest-neighbor queries over vector embeddings. |
| Run Workers AI models | `ai/workers-ai.md` | Bind Workers AI into your Worker with Cloudflare.Workers.AI — run inference and list models directly, or turn the binding into a typed Effect LanguageModel, no gateway required. |

## apis/

| Page | File | Covers |
| --- | --- | --- |
| Effect HTTP API | `apis/effect-http-api.md` | Build a schema-validated HTTP API with Effect's HttpApi module and deploy it as a Cloudflare Worker. |
| Effect RPC | `apis/effect-rpc.md` | Build a typed RPC API with Effect's Rpc module and deploy it as a Cloudflare Worker. |
| Schemaless RPC | `apis/schemaless-rpc.md` | Typed RPC between Workers, Durable Objects, and Containers with no schema — bind the class, get the client. |

## compute/

| Page | File | Covers |
| --- | --- | --- |
| Add a Workflow | `compute/add-a-workflow.md` | Orchestrate durable, multi-step work with Cloudflare Workflows — automatic retries, replayable steps, and at-least-once delivery. |
| Browser rendering | `compute/browser-rendering.md` | Attach Cloudflare Browser Rendering to a Worker — run quick actions like markdown and scrape, stream screenshots and PDFs, or drive the raw binding with puppeteer. |
| Workers Cache | `compute/cache.md` | Serve responses from Cloudflare's edge cache before your Worker even runs — enable it with one yield, control it with standard headers, purge it by tag from inside a handler. |
| Containers | `compute/containers.md` | Cloudflare Containers run long-lived processes beside a Durable Object — declare a typed container class, implement its runtime in a separate file, and alchemy builds the image, pushes it, and wires the DO pairing. |
| Bind to another Worker's Durable Object | `compute/cross-worker-durable-object.md` | Share a Durable Object across multiple Workers — one Worker hosts the runtime, others bind to it by scriptName for a typed RPC stub — and move the host later with the data intact. |
| Durable Objects | `compute/durable-objects.md` | Durable Objects are globally-unique stateful instances with transactional storage — define one as an Effect, persist state per key, expose typed RPC methods, and stream values back to the caller. |
| Gradual deployments | `compute/gradual-deployments.md` | Roll out Worker deploys incrementally — upload preview versions, canary a percentage of live traffic, ramp to 100%, pin users to a version during the rollout, and verify which version served each request. |
| Accept WebSockets | `compute/hibernatable-websockets.md` | Accept WebSocket connections in a Durable Object, broadcast between peers, and survive Cloudflare's hibernation. |
| Worker Previews | `compute/previews.md` | Deploy a branch or pull request as a first-class Preview of another Worker — its own URL, bindings, and isolated Durable Object state, without touching production traffic. |
| Python Workers | `compute/python-workers.md` | Deploy Cloudflare Python Workers by pointing main at a .py file — alchemy uploads the modules, vendors pyproject.toml dependencies with uv, and serves them locally through workerd's built-in Pyodide. |
| Rate limiting | `compute/rate-limiting.md` | Throttle requests inside a Worker with Cloudflare's Rate Limiting binding — declare the limit on the binding, count arbitrary keys at runtime, handle failures as typed errors. |
| Run a Container | `compute/run-a-container.md` | Run a long-lived container alongside a Durable Object, expose RPC methods, and proxy HTTP requests to ports inside the container. |
| Worker Loader | `compute/worker-loader.md` | Load and run ephemeral Workers at runtime from inline source — each in its own sandboxed isolate, with optional outbound-network control and typed RPC entrypoints. |
| Workers for Platforms | `compute/workers-for-platforms.md` | Run your customers' Workers in your own account — create a dispatch namespace, upload user Workers into it, and route requests from a platform Worker with the Get binding. |
| Workers | `compute/workers.md` | Cloudflare Workers are the compute Runtime of every Alchemy app — declare the Worker and its handler in one file, bind resources with full type safety, and call other Workers over schemaless RPC. |
| Workflows | `compute/workflows.md` | Cloudflare Workflows run durable multi-step jobs — define a typed workflow class, checkpoint steps with task and sleep, trigger instances from a Worker, and poll status until completion. |

## data/

| Page | File | Covers |
| --- | --- | --- |
| Store Git Repos with Artifacts | `data/artifacts.md` | Use Cloudflare Artifacts to create Git repos at runtime and hand out clone tokens, all from a tiny Worker. |
| Branch from a shared database | `data/branch-from-shared-database.md` | Have ephemeral PR-preview stages reference a long-lived Neon or PlanetScale database from a staging stage instead of provisioning their own — fast previews, cheap branches, no extra clusters. |
| Drizzle on D1 | `data/d1-drizzle.md` | Deploy committed SQLite migrations to D1 and query the database from a Worker with Drizzle. |
| D1 | `data/d1.md` | Cloudflare D1 is serverless SQLite — create a database, apply migrations on deploy, and query it from a Worker through a typed binding. |
| Add Drizzle ORM | `data/drizzle.md` | Deploy a Cloudflare Worker with Drizzle queries, Hyperdrive connections, and reviewed, committed migrations on Neon or PlanetScale. |
| Hyperdrive | `data/hyperdrive.md` | Cloudflare Hyperdrive pools connections to your external Postgres or MySQL database at the edge — provision a database (Neon or PlanetScale), front it with Hyperdrive, and bind the connection into your Worker. |
| KV | `data/kv.md` | Cloudflare Workers KV is edge key-value storage — create a namespace, bind it into a Worker with read/write-scoped bindings, and get/put values with metadata. |
| Prisma ORM with Postgres | `data/prisma.md` | Deploy Prisma ORM v8 on Cloudflare Workers with Neon Postgres, Hyperdrive, controlled migrations, and Effect-native queries. |
| R2 presigned URLs | `data/r2-presigned-urls.md` | Mint presigned R2 URLs so browsers upload and download objects directly, with the same code in alchemy dev and in production, from Effect-native or async Workers. |
| R2 | `data/r2.md` | Cloudflare R2 is object storage — create a bucket, bind it into a Worker with read/write-scoped bindings, and stream objects in and out. |
| Shared database across stages | `data/shared-database.md` | Have ephemeral PR-preview stages reference a long-lived Neon or PlanetScale database from a staging stage instead of provisioning their own — fast previews, copy-on-write branches, no extra clusters. |

## email/

| Page | File | Covers |
| --- | --- | --- |
| Email | `email/_overview.md` | Cloudflare Email Routing turns a zone into a mail endpoint — enable routing, verify destinations, forward with rules and a catch-all, hand mail to a Worker, and send from Workers with the send_email binding. |
| Receive email in a Worker | `email/email-worker.md` | Receive inbound mail in a Cloudflare Worker with Cloudflare.email({ zone }).subscribe(...) — auto-creates routing and forwarding rules. |
| Send & receive email | `email/send-and-receive.md` | Enable Email Routing on a zone, verify destination addresses, forward inbound mail with rules and a catch-all, and send email from a Worker with the send_email binding. |

## frontend/

| Page | File | Covers |
| --- | --- | --- |
| Astro | `frontend/astro.md` | Deploy an Astro site to Cloudflare Workers with Cloudflare.Website.Astro — SSR in the Worker, prerendered pages as static assets, sessions backed by an auto-provisioned KV namespace. |
| Foldkit | `frontend/foldkit.md` | Deploy a Foldkit app to Cloudflare with the Foldkit resource — one declaration, no Wrangler config. |
| Frontend frameworks | `frontend/frontends.md` | Deploy Vite, Astro, Next.js, vinext, Nuxt, SvelteKit, Waku, or any static build to Cloudflare Workers with first-class Website resources. |
| Full-stack TanStack Start + RPC + Drizzle | `frontend/full-stack-tanstack-rpc-drizzle.md` | Build a reactive full-stack app on Cloudflare — a TanStack Start UI that drives an Effect RPC backend over Drizzle and Neon Postgres, with browser state wired through Effect 4's native atom RPC. |
| Next.js | `frontend/nextjs.md` | Deploy a Next.js app to Cloudflare Workers with Cloudflare.Website.Nextjs — the OpenNext pipeline, writable ISR, and wrangler-free local dev. |
| Nuxt | `frontend/nuxt.md` | Deploy a Nuxt app to Cloudflare Workers with Cloudflare.Website.Nuxt — nitro's cloudflare_module preset, native nuxt.config.ts loading, and wrangler-free local dev. |
| Octane | `frontend/octane.md` | Deploy an OctaneJS fullstack app to Cloudflare Workers with Cloudflare.Website.Octane — native Octane and Vite configuration, no hosting adapter or Wrangler file required. |
| React Router | `frontend/react-router.md` | Deploy React Router v7 — including React Server Components — to Cloudflare with Cloudflare.Website.Vite and viteEnvironments. |
| SolidStart | `frontend/solidstart.md` | Deploy SolidStart to Cloudflare with Cloudflare.Website.Vite — plus the hand-rolled SolidJS SSR variant for full control over the server entry. |
| Static sites | `frontend/static-site.md` | Deploy any build command's output directory as Cloudflare Worker static assets with Cloudflare.Website.StaticSite — custom edge Workers, framework-native local dev, and memoized rebuilds. |
| SvelteKit | `frontend/sveltekit.md` | Deploy a SvelteKit app to Cloudflare Workers with Cloudflare.Website.SvelteKit — a wrangler-free in-memory adapter, real bindings on platform.env, and full-HMR local dev. |
| TanStack Start | `frontend/tanstack-start.md` | Deploy TanStack Start (React or Solid) to Cloudflare with Cloudflare.Website.Vite — SSR, typed Worker bindings, and HMR dev with real cloud resources. |
| Vinext | `frontend/vinext.md` | Deploy vinext to Cloudflare Workers with the shared Website API, native local development, and KV-backed caching. |
| Add a React SPA | `frontend/vite-spa.md` | Ship a React single-page app from the same Stack as your Worker — built with Vite and deployed to Cloudflare in one command. |
| Vite | `frontend/vite.md` | Deploy any pure-Vite app to Cloudflare Workers with a single resource. |
| Vue | `frontend/vue.md` | Deploy a Vue single-page app to Cloudflare with the Vite resource — one declaration, no Wrangler config. |
| Waku | `frontend/waku.md` | Deploy a Waku app to Cloudflare Workers with Cloudflare.Website.Waku — RSC server in the Worker, SSG pages as static assets, and a custom-entry seam for Durable Objects. |

## messaging/

| Page | File | Covers |
| --- | --- | --- |
| Scheduled jobs with Cron Triggers | `messaging/cron.md` | Run Worker code on a schedule — declare a cron expression with an Effect handler, deploy it, and prove the trigger fires with a bounded polling test. |
| React to GitHub events from a Worker | `messaging/github-events.md` | Subscribe a Cloudflare Worker to GitHub repository webhooks with typed payloads — alchemy provisions the webhook and verifies delivery signatures. |
| Queues | `messaging/queues.md` | Cloudflare Queues give you reliable, at-least-once message delivery between Workers — a WriteQueue producer binding on one side and an Effect-style consumeQueueMessages handler with automatic ack/retry on the other. |

## networking/

| Page | File | Covers |
| --- | --- | --- |
| Custom domains & routes | `networking/custom-domains.md` | Serve Workers from your own domain — create or adopt a Zone, attach custom domains, route hostname patterns, manage DNS records, and control the workers.dev subdomain. |
| Domains & DNS | `networking/domains.md` | Manage Cloudflare zones, DNS records, DNSSEC, and zone settings as resources — and safely adopt the domains you already have. |
| Expose private origins with Tunnel | `networking/tunnel.md` | Connect a private origin to Cloudflare's edge with a Tunnel, declare its ingress rules as a Configuration resource, and point DNS at it with a proxied CNAME. |

## observability/

| Page | File | Covers |
| --- | --- | --- |
| Analytics Engine | `observability/analytics-engine.md` | Write time-series data points from a Worker with Workers Analytics Engine — declare a dataset, bind it with WriteDataset, and query it later over Cloudflare's SQL API. |
| Ship Worker telemetry to Axiom | `observability/axiom-observability.md` | Declare Axiom datasets, a least-privilege ingest token, and monitors in the same Stack as the Worker that emits the telemetry — or let Cloudflare push Workers Logs to Axiom natively. |
| Native Workers tracing | `observability/workers-tracing.md` | Mirror Effect spans into Cloudflare Workers Observability with Cloudflare.Telemetry() — the same Layer shape as Axiom.Telemetry, with Cloudflare owning sampling and export. |

## security/

| Page | File | Covers |
| --- | --- | --- |
| Protect a Worker with Access | `security/access.md` | Put Cloudflare Access in front of a Worker with the access prop — per-Worker policies, shared applications, ctx.access identity at runtime, and a local dev simulation. |
| Secrets & env | `security/secrets-env.md` | Bind env vars and secrets to Workers with effect/Config, generate stable tokens with Alchemy.Random, and graduate to Secrets Store when secrets are shared across Workers. |
| Secrets Store & auth tokens | `security/secrets-store.md` | Store secrets in Cloudflare's account-level Secrets Store, generate stable tokens with Alchemy.Random, and read them in a Worker through the ReadSecret binding. |
| Turnstile CAPTCHA | `security/turnstile.md` | Manage Cloudflare Turnstile widgets as resources — deploy a widget, embed its sitekey in HTML, and verify tokens server-side with the redacted secret. |

## tutorial/

| Page | File | Covers |
| --- | --- | --- |
| Part 1: Your First Stack | `tutorial/part-1.md` | Install Alchemy, create a Stack with a Cloudflare R2 Bucket, and deploy it. |
| Part 2: Add a Worker | `tutorial/part-2.md` | Create a Cloudflare Worker, bind the R2 Bucket, and implement GET/PUT routes. |
| Part 3: Testing | `tutorial/part-3.md` | Write integration tests that deploy your stack and make HTTP requests against your live Worker. |
| Part 4: Local Dev | `tutorial/part-4.md` | Run your stack locally with alchemy dev for hot reloading and instant feedback. |
| Part 5: CI/CD | `tutorial/part-5.md` | Set up GitHub Actions for automated deployments, PR previews, and remote state — with Cloudflare credentials managed as code. |
| Part 6: Observability | `tutorial/part-6.md` | Ship your Worker traces and logs to Axiom — datasets, an ingest token, and the Axiom.Telemetry binding layer declared in the same Stack as the Worker they observe. |
