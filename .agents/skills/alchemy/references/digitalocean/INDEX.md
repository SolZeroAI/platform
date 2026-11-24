# digitalocean index

44 pages. Run Effect programs on DigitalOcean with Alchemy. Declare Apps, Functions, Droplets, Kubernetes, Spaces, Managed Databases, AI agents and networking in one TypeScript program.

| Page | File | Covers |
| --- | --- | --- |
| DigitalOcean | `_overview.md` | Run Effect programs on DigitalOcean with Alchemy. Declare Apps, Functions, Droplets, Kubernetes, Spaces, Managed Databases, AI agents and networking in one TypeScript program. |
| Setup | `setup.md` | Install Alchemy and connect it to DigitalOcean — create a personal access token for your team and store it in a profile. |
| Teams, projects and tokens | `teams-projects-and-tokens.md` | How a DigitalOcean team holds your resources and billing, how a personal access token decides where Alchemy deploys, how to keep production in its own team, and the narrower keys bindings create for your runtimes. |
| What is DigitalOcean? | `what-is-digitalocean.md` | The concepts behind DigitalOcean — teams, tokens, projects, regions, App Platform, Functions, Droplets, Kubernetes, Sandboxes, Spaces, Managed Databases, AI agents, networking and monitoring — and how @alchemy.run/digitalocean models each of them. |

## ai/

| Page | File | Covers |
| --- | --- | --- |
| Action Gateway | `ai/action-gateway.md` | Give agents tools through DigitalOcean's Action Gateway, with toolbelts, MCP endpoints, approval rules, output views, your own MCP servers, provider credentials and per-actor limits. |
| Agent harness | `ai/agent-harness.md` | Run coding agents like OpenCode and Claude Code in DigitalOcean Harness Runtime sessions, each in its own sandbox, start them from your App, and schedule them with triggers. |
| GenAI agents | `ai/genai-agents.md` | Build DigitalOcean GenAI Platform agents with instructions, knowledge bases, function calls and routes to other agents, and call them from any runtime with a key of their own. |
| Inference | `ai/inference.md` | Call models by name with DigitalOcean Serverless Inference from any runtime (chat, embeddings, images, speech, video and batches), or serve an open-weight model on GPUs reserved for you with Dedicated Inference. |

## compute/

| Page | File | Covers |
| --- | --- | --- |
| App Platform | `compute/app-platform.md` | Run an Effect or async program on DigitalOcean App Platform as an HTTPS service, with instance sizes, scheduled jobs, alerts, secrets and the team's Container Registry. |
| Choosing a runtime | `compute/choosing-a-runtime.md` | How App Platform services and jobs, Functions, Kubernetes and Droplets differ in what starts them, how they scale and what they cost, and how to choose one for each part of an app. |
| Droplets | `compute/droplets.md` | Run DigitalOcean Droplets with cloud-init, SSH keys, volumes, snapshots, backups and autoscale pools, and know which changes update a Droplet in place and which replace it. |
| Functions | `compute/functions.md` | Run Effect or async handlers as DigitalOcean Functions, deploy single-file functions in any runtime, schedule them with triggers, and call them from other runtimes with a scoped access key. |
| Kubernetes | `compute/kubernetes.md` | Create DigitalOcean Kubernetes (DOKS) clusters and node pools, apply manifests from the same Stack, pull images from the team's registry, install 1-Click apps and forward logs. |
| Sandboxes | `compute/sandboxes.md` | Create DigitalOcean MicroVM sandboxes from a template while your program runs, run untrusted code in them, expose a port, pause and resume them, and delete them when done. |

## data/

| Page | File | Covers |
| --- | --- | --- |
| Managed Databases | `data/managed-databases.md` | Run managed PostgreSQL, MySQL, Valkey, MongoDB, Kafka and OpenSearch clusters on DigitalOcean, apply SQL migrations on deploy, connect from runtimes, and add users, pools, replicas and trusted sources. |
| Spaces | `data/spaces.md` | Store objects in DigitalOcean Spaces buckets, read and write them from any runtime with keys scoped to one bucket, serve them through the CDN, and set CORS, versioning and lifecycle rules. |
| Vector Databases | `data/vector-databases.md` | Run a managed Weaviate vector database on DigitalOcean and connect to it from a runtime with its endpoints and API key. |
| Volumes and NFS | `data/volumes-nfs.md` | Give Droplets disks that outlive them with Block Storage Volumes, share files between Droplets and Kubernetes nodes with managed NFS, and snapshot Volumes. |

## frontend/

| Page | File | Covers |
| --- | --- | --- |
| Astro | `frontend/astro.md` | Deploy a Astro app to DigitalOcean App Platform with DigitalOcean.Website.Astro, built on your machine and served by an App, with Astro's own dev server under alchemy dev. |
| Foldkit | `frontend/foldkit.md` | Deploy a Foldkit app to DigitalOcean App Platform with DigitalOcean.Website.Foldkit, built on your machine and served by an App, with Foldkit's own dev server under alchemy dev. |
| Next.js | `frontend/nextjs.md` | Deploy a Next.js app to DigitalOcean App Platform with DigitalOcean.Website.Nextjs, built on your machine and served by an App, with Next.js's own dev server under alchemy dev. |
| Nuxt | `frontend/nuxt.md` | Deploy a Nuxt app to DigitalOcean App Platform with DigitalOcean.Website.Nuxt, built on your machine and served by an App, with Nuxt's own dev server under alchemy dev. |
| Octane | `frontend/octane.md` | Deploy a Octane app to DigitalOcean App Platform with DigitalOcean.Website.Octane, built on your machine and served by an App, with Octane's own dev server under alchemy dev. |
| React Router | `frontend/react-router.md` | Deploy a React Router app to DigitalOcean App Platform with DigitalOcean.Website.ReactRouter, built on your machine and served by an App, with React Router's own dev server under alchemy dev. |
| SolidStart | `frontend/solidstart.md` | Deploy a SolidStart app to DigitalOcean App Platform with DigitalOcean.Website.SolidStart, built on your machine and served by an App, with SolidStart's own dev server under alchemy dev. |
| SvelteKit | `frontend/sveltekit.md` | Deploy a SvelteKit app to DigitalOcean App Platform with DigitalOcean.Website.SvelteKit, built on your machine and served by an App, with SvelteKit's own dev server under alchemy dev. |
| TanStack Start | `frontend/tanstack-start.md` | Deploy a TanStack Start app to DigitalOcean App Platform with DigitalOcean.Website.TanStackStart, built on your machine and served by an App, with TanStack Start's own dev server under alchemy dev. |
| Vinext | `frontend/vinext.md` | Deploy a Vinext app to DigitalOcean App Platform with DigitalOcean.Website.Vinext, built on your machine and served by an App, with Vinext's own dev server under alchemy dev. |
| Vite | `frontend/vite.md` | Deploy a Vite app to DigitalOcean App Platform with DigitalOcean.Website.Vite, built on your machine and served by an App, with Vite's own dev server under alchemy dev. |
| Vocs | `frontend/vocs.md` | Deploy a Vocs app to DigitalOcean App Platform with DigitalOcean.Website.Vocs, built on your machine and served by an App, with Vocs's own dev server under alchemy dev. |
| Waku | `frontend/waku.md` | Deploy a Waku app to DigitalOcean App Platform with DigitalOcean.Website.Waku, built on your machine and served by an App, with Waku's own dev server under alchemy dev. |
| Websites | `frontend/websites.md` | Deploy Astro, Next.js, Nuxt, SvelteKit, SolidStart, React Router, TanStack Start, Waku, Vinext, Vite, Vocs, Foldkit, Octane and static sites to DigitalOcean App Platform from one Stack. |

## networking/

| Page | File | Covers |
| --- | --- | --- |
| DNS | `networking/dns.md` | Host domains on DigitalOcean DNS and manage their records from a Stack, pointing names at Droplets, load balancers and reserved IPs. |
| Firewalls | `networking/firewalls.md` | Control which traffic reaches DigitalOcean Droplets with Cloud Firewalls, applied by Droplet id or by tag, with inbound and outbound rules. |
| Load balancers and certificates | `networking/load-balancers.md` | Spread traffic across DigitalOcean Droplets with load balancers, terminate HTTPS with Let's Encrypt or your own certificates, and check backend health. |
| Reserved IPs | `networking/reserved-ips.md` | Keep a public address on DigitalOcean that stays the same when the Droplet behind it is replaced, and move it between Droplets. |
| VPCs and NAT | `networking/vpcs.md` | Put Droplets, Kubernetes clusters and databases on a private DigitalOcean VPC, peer two VPCs, and give private machines one outbound address with a NAT gateway. |

## observability/

| Page | File | Covers |
| --- | --- | --- |
| Monitoring and Insights | `observability/monitoring.md` | Watch DigitalOcean resources with uptime checks, Droplet alert policies and Insights alert rules, send alerts to email, Slack or webhooks, forward Kubernetes logs, and query metrics and logs from a runtime. |

## security/

| Page | File | Covers |
| --- | --- | --- |
| Secrets | `security/secrets.md` | Give DigitalOcean Apps and Functions API keys and passwords as Config values from .env or a secrets manager, or keep shared values in DigitalOcean Secrets and read them with ReadSecret. |

## tutorial/

| Page | File | Covers |
| --- | --- | --- |
| Part 1: Your First App | `tutorial/part-1.md` | Create a Stack, write an Effect HTTP handler, and deploy it to App Platform with its own Container Registry. |
| Part 2: Store Files in Spaces | `tutorial/part-2.md` | Declare a Spaces bucket, give the App a key that reaches only that bucket, and read and write objects from a handler. |
| Part 3: Add a Postgres Database | `tutorial/part-3.md` | Declare a managed PostgreSQL cluster, apply SQL migrations on every deploy, and query it from the App with its connection string. |
| Part 4: Run a Nightly Job | `tutorial/part-4.md` | Schedule an App Platform job from the same program, so a report of the day's visits lands in Spaces every night. |
| Part 5: Ship to Production | `tutorial/part-5.md` | Deploy a second copy of the Stack as a stage, give production its own team and profile, deploy from CI, and tear down what you no longer need. |
