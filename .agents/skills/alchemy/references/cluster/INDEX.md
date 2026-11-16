# cluster index

23 pages. Run Effect Cluster entities, workflows, singletons and crons with Alchemy — a Postgres database and a pool of runners on Docker, AWS, GCP, Kubernetes, Fly or Hetzner, or Durable Objects on Cloudflare.

| Page | File | Covers |
| --- | --- | --- |
| Effect Cluster | `_overview.md` | Run Effect Cluster entities, workflows, singletons and crons with Alchemy — a Postgres database and a pool of runners on Docker, AWS, GCP, Kubernetes, Fly or Hetzner, or Durable Objects on Cloudflare. |
| AWS | `aws.md` | Run an Effect Cluster's database on RDS and its runners on ECS Fargate, called from Lambda or anywhere through a load balancer. |
| Calling an entity | `calling.md` | Call an Effect Cluster entity from any runtime by id — RPCs, streams, typed errors, fire-and-forget messages and headers. |
| Cloudflare | `cloudflare.md` | Run an Effect Cluster's entities, workflows, singletons and crons on Cloudflare Durable Objects, with no database and no servers to manage. |
| Crons | `crons.md` | Run a job on a schedule with an Effect Cluster cron — once per scheduled time across the cluster, with the schedule on its Layer. |
| Databases | `databases.md` | The Postgres an Effect Cluster coordinates through — what runners keep in it, and how to run one on any cloud or connect to one you have. |
| Docker | `docker.md` | Run an Effect Cluster's database and runners on a Docker swarm, on your machine or a server. |
| Entities | `entities.md` | How an Effect Cluster entity is written in Alchemy — its declaration, its two-phase implementation, its instances, and where its code lives. |
| Existing programs | `existing-programs.md` | Deploy an Effect Cluster program you already have, unchanged, on a pool of its own, and call its entities from any runtime. |
| Fly | `fly.md` | Run an Effect Cluster's database and runners on Fly.io, on a private network, with the gateway at the pool's fly.dev address. |
| GCP | `gcp.md` | Run an Effect Cluster's database and runners on Compute Engine, called from Cloud Run or anywhere through a regional load balancer. |
| Hetzner | `hetzner.md` | Run an Effect Cluster's database and runners on Hetzner Cloud Servers, on a private Network, behind a Load Balancer. |
| Kubernetes | `kubernetes.md` | Run an Effect Cluster's database and runners on any Kubernetes cluster — EKS, GKE, or kind on your machine. |
| RPC middleware | `middleware.md` | Authenticate and enrich every message to an entity with Effect RPC middleware — a server side that runs on the pool and a client side that runs in the caller. |
| Pools | `pools.md` | How a pool of Effect Cluster runners hosts your entities, workflows, singletons and crons — what's bundled together, shard groups, the gateway, and how to split work across pools. |
| Setup | `setup.md` | Install the Effect Cluster provider and get Docker ready to run a cluster on your machine. |
| Singletons | `singletons.md` | Run one fiber across the whole cluster with an Effect Cluster singleton — on exactly one runner, moved when that runner stops. |
| What is Effect Cluster? | `what-is-effect-cluster.md` | The concepts behind Effect Cluster — entities addressed by id, messages handled one at a time, shards, runners and pools, the database, workflows, singletons and crons — and how @alchemy.run/effect-cluster deploys them. |
| Workflows | `workflows.md` | Durable workflows on Effect Cluster — persisted activities, durable sleeps, signals, compensations and child workflows — declared and implemented like an entity and started from any runtime. |

## tutorial/

| Page | File | Covers |
| --- | --- | --- |
| Part 1: Your First Entity | `tutorial/part-1.md` | Run an Effect Cluster database and runners on Docker, and deploy a chat room entity that tracks who's in it. |
| Part 2: Signed-In Members | `tutorial/part-2.md` | Add Effect RPC middleware so a room only lets signed-in users join, and provide it with the pool. |
| Part 3: Invitations | `tutorial/part-3.md` | Add a durable workflow that invites someone to a room, waits for their answer, and lets them in. |
| Part 4: Run It on AWS | `tutorial/part-4.md` | Move the chat rooms from Docker to AWS by swapping the database, the pool and the API's host. |
