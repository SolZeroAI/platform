# rivet index

29 pages. Build on Rivet with Alchemy. Declare Durable Objects and Durable Streams in TypeScript, run the control plane and its nodes on the cloud you choose or on Rivet Cloud, and call any instance by name from any runtime.

| Page | File | Covers |
| --- | --- | --- |
| Rivet | `_overview.md` | Build on Rivet with Alchemy. Declare Durable Objects and Durable Streams in TypeScript, run the control plane and its nodes on the cloud you choose or on Rivet Cloud, and call any instance by name from any runtime. |
| Four ways to build Actors | `actors.md` | Build Rivet Actors as Alchemy Durable Objects, with RivetKit, with RivetKit's Effect SDK, or in Rust — what each one is for, and how all four deploy to the same control planes and pools. |
| AWS | `aws.md` | Run a Rivet control plane on EC2 or ECS, and pools of nodes on Fargate or EC2. |
| Calling a Durable Object | `calling.md` | How any runtime calls a Rivet Durable Object by name — methods, streams, typed errors, HTTP requests, and calls from one Durable Object to another. |
| Concurrency | `concurrency.md` | How a Rivet Durable Object runs calls in parallel, how a transaction keeps a read and a write together, and how Workers.InputGate gives code written for Cloudflare the same rule it has there. |
| Control Plane | `control-planes.md` | What a Rivet control plane does, how to run one as a Layer on any cloud, how many engines it needs, and how to use one you already have. |
| Docker | `docker.md` | Run a Rivet control plane and pools of nodes on a Docker swarm, on your machine or a server. |
| Durable Object | `durable-objects.md` | What a Rivet Durable Object is — a class with one instance per name, each with its own state — and how one is written, from its two phases and methods to fetch, alarm, and keeping its code out of its callers. |
| Durable Streams | `durable-streams.md` | Append-only logs with a replayable history, one per key, served by Rivet Services — declare one with its message Schema, append, read from an offset, follow it live, and choose its wire format as a Layer. |
| Fly | `fly.md` | Run a Rivet control plane on Fly Machines and pools of nodes on a Fly Service. |
| GCP | `gcp.md` | Run a Rivet control plane on Compute Engine, and pools of nodes on Cloud Run or Compute Engine. |
| Hetzner | `hetzner.md` | Run a Rivet control plane and pools of nodes on Hetzner Cloud Servers. |
| Kubernetes | `kubernetes.md` | Run a Rivet control plane and pools of nodes on any Kubernetes cluster — EKS, GKE, kind or your own. |
| Control planes and namespaces | `namespaces.md` | What holds a Rivet app — a control plane you run or Rivet Cloud, divided into namespaces — how Alchemy gives each stage its own namespace, and when to give an environment a control plane of its own. |
| Pool | `pools.md` | How a Rivet pool decides which machines run your Durable Objects, and when to share a pool, split one, or scale it. |
| Railway | `railway.md` | Run pools of Rivet nodes on Railway, on a control plane on another cloud. |
| Rivet Cloud | `rivet-cloud.md` | Use Rivet Cloud as the control plane, sign in to it from the alchemy CLI or CI, and run your nodes on Rivet Cloud or on any cloud. |
| RivetKit Effect Actors | `rivetkit-effect.md` | Deploy Actors written with RivetKit's Effect SDK, unchanged, to a Rivet control plane and pool on any cloud. |
| Rust Actors | `rivetkit-rust.md` | Deploy Actors written with RivetKit's Rust SDK, unchanged, to a Rivet control plane and pool. Alchemy compiles the crate into the pool's node image. |
| RivetKit Actors | `rivetkit.md` | Deploy Actors written with RivetKit, unchanged, to a Rivet control plane and pool on any cloud. |
| Secrets | `secrets.md` | Give a Rivet Durable Object an API key or a password with Config, hand a control plane its object storage keys, and choose where each stage's values come from. |
| Setup | `setup.md` | Install the Rivet provider, the provider for the cloud you run it on, and get Docker ready to run Rivet on your machine. |
| Storage | `storage.md` | What each Rivet Durable Object instance keeps — key-value entries, a SQL database and one alarm — and how to change it safely. |
| Tokens and networks | `tokens-and-networks.md` | Who can reach a Rivet control plane and with what — the admin token and everything that holds it, the HTTPS address each control plane gets without a domain, nodes that only connect out, and the credentials a deploy needs in CI. |
| What is Rivet? | `what-is-rivet.md` | The concepts behind Rivet — Actors, one instance per name, state that lives with it, sleeping and waking, calls, the control plane, namespaces, pools, the gateway, Rivet Services and Rivet Cloud — and how @alchemy.run/rivet models each of them. |

## tutorial/

| Page | File | Covers |
| --- | --- | --- |
| Part 1: Your First Durable Object | `tutorial/part-1.md` | Run a Rivet control plane and pool on Docker, and deploy a chat room that counts its visitors. |
| Part 2: Messages in SQL | `tutorial/part-2.md` | Give each room a SQL table of messages, and post and read them over HTTP. |
| Part 3: Clear Idle Rooms | `tutorial/part-3.md` | Use a Durable Object alarm to clear a room's messages an hour after the last one. |
| Part 4: Run It on Hetzner | `tutorial/part-4.md` | Move the chat rooms from Docker to Hetzner Cloud by swapping the control plane, the pool and the API's host. |
