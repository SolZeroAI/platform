# gcp index

51 pages. Build on Google Cloud with Alchemy. Declare Cloud Run services, jobs, Firestore, Cloud Storage and Pub/Sub in TypeScript, and let bindings grant each runtime's service account the roles its code uses.

| Page | File | Covers |
| --- | --- | --- |
| GCP | `_overview.md` | Build on Google Cloud with Alchemy. Declare Cloud Run services, jobs, Firestore, Cloud Storage and Pub/Sub in TypeScript, and let bindings grant each runtime's service account the roles its code uses. |
| Projects and regions | `projects-and-regions.md` | How GCP projects isolate resources and sit in an organization, how regions and zones place them, and how profiles and stages choose where each Alchemy deploy goes. |
| Setup | `setup.md` | Connect alchemy to Google Cloud — project, service-account key, the APIs to enable, and Docker. |
| What is GCP? | `what-is-gcp.md` | The concepts behind Google Cloud — organizations, projects, APIs, regions, IAM principals, roles and service accounts, Cloud Run and the other runtimes, events, networks and logging — and how @alchemy.run/gcp models each of them. |

## ai/

| Page | File | Covers |
| --- | --- | --- |
| Vertex AI | `ai/vertex-ai.md` | Call Gemini on Vertex AI from Cloud Run with the GenerateContent binding — no API key, just the service's own identity. |

## apis/

| Page | File | Covers |
| --- | --- | --- |
| Effect HTTP API on Cloud Run | `apis/effect-http-api.md` | Build a schema-validated HTTP API with Effect's HttpApi module, deploy it to Cloud Run, and call it from a typed client. |
| Effect RPC on Cloud Run | `apis/effect-rpc.md` | Build a typed RPC API with Effect's Rpc module, deploy it to Cloud Run, and call its procedures from a typed client. |

## compute/

| Page | File | Covers |
| --- | --- | --- |
| Choosing a runtime | `compute/choosing-a-runtime.md` | How Cloud Run services, jobs and worker pools, Cloud Functions and GKE differ in what triggers them, how they scale and what they cost, and how to choose one for each part of an app. |
| Cloud Functions | `compute/cloud-functions.md` | Deploy an Effect fetch handler as a 2nd-gen Cloud Function — built by Google from an uploaded bundle, so no local Docker is needed. |
| Cloud Run | `compute/cloud-run.md` | Run an Effect HTTP service on Cloud Run with GCP.Function — public or private URLs, environment, scaling, and bindings that grant IAM. |
| GKE | `compute/gke.md` | Run Effect programs as Kubernetes Deployments and Jobs on a GKE Autopilot cluster, with bindings granted through Workload Identity. |
| Cloud Run jobs | `compute/jobs.md` | Run batch work to completion with GCP.Run.Job — trigger it from a service with RunJob, or nightly with Cloud Scheduler. |
| Cloud Run sidecars | `compute/sidecars.md` | Run more containers next to a Cloud Run service — plain images, GCP.Run.Container resources, or your own Effect programs — and control the order they start in. |
| Worker pools | `compute/worker-pools.md` | Run always-on queue consumers with GCP.Run.WorkerPool — no URL, a fixed instance count, and a Pub/Sub pull loop. |

## data/

| Page | File | Covers |
| --- | --- | --- |
| BigQuery | `data/bigquery.md` | Create BigQuery datasets and tables, stream rows in, and run parameterized queries from Cloud Run with ReadTable and WriteTable bindings. |
| Cloud SQL | `data/cloud-sql.md` | Run Postgres on Cloud SQL, connect Cloud Run to it over the Cloud SQL socket with GCP.SQL.Connect, and query it with Drizzle. |
| Firestore | `data/firestore.md` | Create a Firestore database and read and write documents from Cloud Run with typed Read, Write, and ReadWrite bindings. |
| Memorystore | `data/memorystore.md` | Create a Memorystore for Redis instance and reach it from Cloud Run over Direct VPC egress with the ReadWriteRedis binding. |
| Cloud Storage | `data/storage.md` | Create Cloud Storage buckets, read and write objects from Cloud Run with Read, Write, and ReadWrite bindings, and hand out signed download URLs. |

## frontend/

| Page | File | Covers |
| --- | --- | --- |
| Astro | `frontend/astro.md` | Deploy an Astro site to Cloud Run with GCP.Website.Astro — server-rendered pages, prerendered pages, and Astro's own dev server under alchemy dev. |
| Foldkit | `frontend/foldkit.md` | Deploy a Foldkit app to Cloud Run with GCP.Website.Foldkit — a Vite build with deep links that boot the app. |
| Next.js | `frontend/nextjs.md` | Deploy a Next.js app to Cloud Run with GCP.Website.Nextjs — Next's own production server in a container, no OpenNext. |
| Nuxt | `frontend/nuxt.md` | Deploy a Nuxt app to Cloud Run with GCP.Website.Nuxt — the nitro Node server in a container, prerendered pages served as static files. |
| Octane | `frontend/octane.md` | Deploy an OctaneJS app to Cloud Run with GCP.Website.Octane. |
| React Router | `frontend/react-router.md` | Deploy a React Router v8 app in framework mode to Cloud Run with GCP.Website.ReactRouter. |
| SolidStart | `frontend/solidstart.md` | Deploy a SolidStart app to Cloud Run with GCP.Website.SolidStart — SSR in a container, prerendered pages served as static files. |
| Static sites | `frontend/static-site.md` | Deploy Hugo, Zola, or any static build to Google Cloud — on Cloud Run with GCP.Website.StaticSite, or from a public Cloud Storage bucket. |
| SvelteKit | `frontend/sveltekit.md` | Deploy a SvelteKit app to Cloud Run with GCP.Website.SvelteKit — kit's server in a container, static assets served first. |
| TanStack Start | `frontend/tanstack-start.md` | Deploy a TanStack Start app (React or Solid) to Cloud Run with GCP.Website.TanStackStart — your own vite build, served by a Node server. |
| vinext | `frontend/vinext.md` | Deploy a vinext app (the Next.js API on Vite) to Cloud Run with GCP.Website.Vinext. |
| React SPA | `frontend/vite-spa.md` | Deploy a React single-page app to Cloud Run with GCP.Website.Vite — scaffold with Vite, deep links answered by index.html, Vite's dev server under alchemy dev. |
| Vite | `frontend/vite.md` | Deploy any client-only Vite app to Cloud Run with GCP.Website.Vite — your own vite.config, a small static file server, and Vite's dev server under alchemy dev. |
| Vocs | `frontend/vocs.md` | Deploy a Vocs documentation site to Cloud Run with GCP.Website.Vocs. |
| Vue | `frontend/vue.md` | Deploy a Vue single-page app to Cloud Run with GCP.Website.Vite — scaffold with create-vue, deep links answered by index.html. |
| Waku | `frontend/waku.md` | Deploy a Waku (React Server Components) app to Cloud Run with GCP.Website.Waku. |
| Websites | `frontend/websites.md` | Deploy Vite, Astro, Next.js, Nuxt, SvelteKit, TanStack Start, React Router, SolidStart, Waku, vinext, Octane, Vocs, or any static build to Cloud Run with GCP.Website. |

## messaging/

| Page | File | Covers |
| --- | --- | --- |
| Eventarc | `messaging/eventarc.md` | React to Firestore changes, Cloud Storage events, and audit-logged Google API calls with GCP.Eventarc.consumeEvents. |
| Pub/Sub | `messaging/pubsub.md` | Publish to Pub/Sub topics from Cloud Run, consume them with push delivery or a pull loop, filter by attribute, and dead-letter failures. |
| Cloud Scheduler | `messaging/scheduler.md` | Run code on a cron schedule with GCP.CloudScheduler.consumeSchedule — the handler lives on your Cloud Run service and only Cloud Scheduler can call it. |
| Storage events | `messaging/storage-events.md` | Run code when an object lands in a Cloud Storage bucket with GCP.Storage.consumeBucketEvents. |

## networking/

| Page | File | Covers |
| --- | --- | --- |
| Private services | `networking/private-services.md` | Keep a Cloud Run service private and call it from another service with GCP.Run.InvokeService and Google-signed identity tokens. |
| VPC & private networking | `networking/vpc.md` | Give Cloud Run services Direct VPC egress to reach private IPs like Memorystore, and create your own VPC networks and subnets. |

## observability/

| Page | File | Covers |
| --- | --- | --- |
| Logging & Monitoring | `observability/monitoring.md` | Declare uptime checks, alert policies, notification channels, and logs-based metrics in the same Stack as the services they watch. |

## security/

| Page | File | Covers |
| --- | --- | --- |
| Federated identity | `security/federated-identity.md` | How a Lambda or Fly Service reaches GCP, and a Cloud Run service reaches AWS, through workload identity federation instead of long-lived keys. |
| IAM & bindings | `security/iam.md` | What a GCP binding does — the per-runtime service account, the role it grants, where the grant lands, and how removing a binding revokes it. |
| Secret Manager & KMS | `security/secrets-kms.md` | Keep API keys in Secret Manager and read them per request, encrypt data with Cloud KMS, and pass plain config through env. |

## tutorial/

| Page | File | Covers |
| --- | --- | --- |
| Part 1: Your First Stack | `tutorial/part-1.md` | Install Alchemy, create a Stack with a Cloud Storage Bucket, and deploy it to Google Cloud. |
| Part 2: Add a Cloud Run Service | `tutorial/part-2.md` | Put an HTTP service on Cloud Run, bind the Cloud Storage Bucket, and implement GET/PUT routes. |
| Part 3: Testing | `tutorial/part-3.md` | Write integration tests that deploy your stack and make HTTP requests against the live Cloud Run service. |
| Part 4: Stages | `tutorial/part-4.md` | Deploy isolated dev, staging, and prod copies of your stack with --stage, and tune Cloud Run per stage. |
| Part 5: CI/CD | `tutorial/part-5.md` | Deploy from GitHub Actions with Workload Identity Federation — production on main, a preview stage per pull request, no service-account keys in GitHub. |
