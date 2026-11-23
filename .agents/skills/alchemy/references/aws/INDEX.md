# aws index

62 pages. Build on AWS with Alchemy. Declare Lambda Functions, containers, tables, buckets and queues in TypeScript, and let bindings write each runtime's IAM policy from the calls its code makes.

| Page | File | Covers |
| --- | --- | --- |
| AWS | `_overview.md` | Build on AWS with Alchemy. Declare Lambda Functions, containers, tables, buckets and queues in TypeScript, and let bindings write each runtime's IAM policy from the calls its code makes. |
| Accounts and regions | `accounts-and-regions.md` | How AWS accounts isolate resources, how regions and Availability Zones place them, and how profiles and stages choose where each Alchemy deploy goes. |
| IAM and bindings | `iam.md` | How IAM identities, roles, trust, resource-based policies and tag-based access (ABAC) work on AWS, and how Alchemy bindings write each runtime's least-privilege policies from the calls its code makes. |
| Local development | `local-development.md` | alchemy dev runs your AWS stack on your machine — Lambda in Docker containers, local S3/DynamoDB/SQS, event sources firing, hot reload — with no AWS account or credentials required. |
| Setup | `setup.md` | Connect Alchemy to AWS with SSO, console login, stored access keys, or CI environment credentials. |
| What is AWS? | `what-is-aws.md` | The concepts behind AWS — accounts, regions, IAM identities and policies, resources and ARNs, runtimes, event sources, VPCs and the edge — and how @alchemy.run/aws models each of them. |

## ai/

| Page | File | Covers |
| --- | --- | --- |
| Bedrock & Effect AI | `ai/bedrock.md` | Drive Effect's LanguageModel service with Amazon Bedrock models from a Lambda Function — IAM-scoped bindings, streaming, and tool calling over the Converse API. |

## apis/

| Page | File | Covers |
| --- | --- | --- |
| REST API (API Gateway v1) | `apis/api-gateway.md` | Expose a Lambda with a regional Amazon API Gateway REST API using RestApi, Resource, Method, Deployment, and Stage primitives. |
| Effect HTTP API on Lambda | `apis/effect-http-api.md` | Build a schema-validated HTTP API with Effect's HttpApi module and deploy it as an AWS Lambda Function behind a Function URL. |
| Effect RPC on Lambda | `apis/effect-rpc.md` | Build a typed RPC API with Effect's Rpc module and deploy it as an AWS Lambda Function behind a Function URL. |
| Schemaless RPC | `apis/schemaless-rpc.md` | Typed RPC from a Lambda Function into a MicroVM with no schema — declare the image's Shape, connect, get the client. |

## compute/

| Page | File | Covers |
| --- | --- | --- |
| Choosing a runtime | `compute/choosing-a-runtime.md` | How Lambda Functions, Lambda Web Functions, ECS, EKS and EC2 differ in how they run your code, scale and cost, and how to choose one for each part of an app. |
| EC2 | `compute/ec2.md` | How EC2 instances give you a whole virtual machine, how to launch one from an image into a subnet, how to run your Effect program on it as a service, and how to reach it. |
| ECS Sandboxes | `compute/ecs-sandboxes.md` | Create a Nitro Sandbox per user or session on ECS from a Lambda Function, then run commands, use files, open terminals and call ports in it through a typed handle. |
| ECS | `compute/ecs.md` | How ECS runs containers on Fargate through clusters, task definitions, tasks and services, and how to run a server, a one-off job or a scheduled job from an image, a Dockerfile or an Effect program. |
| Effect workflows | `compute/effect-workflows.md` | Run Effect workflows on AWS Lambda durable functions. Host them in an AWS.Lambda.WorkflowFunction, start runs from other functions with AWS.Lambda.DurableFunctionEngine, and let them sleep and wait durably. |
| EKS | `compute/eks.md` | Stand up an EKS Auto Mode cluster on a Network and run containers on it — Deployments for servers, Jobs for run-to-completion work, Manifests for everything else. No YAML, no kubectl. |
| HyperPod | `compute/hyperpod.md` | Provision SageMaker HyperPod clusters — Slurm or EKS orchestrated — and run ML workloads on them with sbatch, raw manifests, or effectful Jobs with task governance. |
| Lambda | `compute/lambda.md` | How a Lambda Function runs your code per invocation, how it's invoked over a Function URL, by events or by other code, and how construction, timeouts and configuration work. |
| Lambda MicroVMs | `compute/microvms.md` | Build a Firecracker MicroVM image from TypeScript or a Dockerfile, then launch and drive isolated stateful instances from a Lambda Function with typed lifecycle bindings and RPC. |
| Nitro Sandboxes | `compute/nitro-sandboxes.md` | How Nitro Sandboxes run each ECS task, EKS pod or self-managed workload in its own lightweight VM on your EC2 instances, the difference between isolated and confidential modes, and how to turn them on for ECS, EKS and EC2. |
| Lambda Web Functions | `compute/web-functions.md` | Run an HTTP server on AWS Lambda Web Functions — an Effect fetch handler or any Node server, with streaming responses, many concurrent requests per environment, and a built-in HTTPS endpoint. |

## data/

| Page | File | Covers |
| --- | --- | --- |
| Drizzle + Aurora PostgreSQL | `data/drizzle-aurora.md` | Drizzle on Lambda with private Aurora PostgreSQL, IAM authentication, verified TLS, and reviewed SQL migrations. |
| Drizzle + Aurora DSQL | `data/drizzle-dsql.md` | Drizzle on Lambda with Aurora DSQL, a non-admin database role, verified TLS, and an explicit DSQL migration boundary. |
| DynamoDB | `data/dynamodb.md` | How DynamoDB Tables store items under partition and sort keys, how to design keys and indexes for the reads you need, and how runtimes read, write and react to items through bindings. |
| RDS & Aurora | `data/rds.md` | How RDS and Aurora run Postgres and MySQL inside your VPC, how the Aurora helper creates a cluster with its secret, subnets and instances, and how runtimes connect, migrate and scale it. |
| S3 | `data/s3.md` | How S3 Buckets hold objects under keys, how a runtime reads and writes them through bindings, and how to share, react to and serve the objects you store. |

## email/

| Page | File | Covers |
| --- | --- | --- |
| Email receiving | `email/receiving.md` | Receive inbound email with SES — rule sets and rules that store mail in S3, fan out to SNS, invoke a Lambda, or bounce it, plus IP filters and the active rule set pointer. |
| Sending & managing email | `email/sending.md` | Send email with SES — verify identities, send from a Lambda with the SendEmail binding, manage contact lists, tenants, dedicated IP pools, account settings, and deliverability insights. |

## frontend/

| Page | File | Covers |
| --- | --- | --- |
| Astro | `frontend/astro.md` | Deploy an Astro app to AWS with AWS.Website.Astro — SSR on a Lambda Web Function, static output on S3 + CloudFront, and Astro's own dev server under alchemy dev. |
| Foldkit | `frontend/foldkit.md` | Deploy Foldkit SPA, SSR, SSG, and hybrid applications to AWS with native local development. |
| Full-stack TanStack Start + RPC + Drizzle | `frontend/full-stack-tanstack-rpc-drizzle.md` | Build a reactive full-stack app on AWS — a TanStack Start UI on CloudFront and Lambda that drives an Effect RPC Lambda over Drizzle and Aurora DSQL, with browser state wired through Effect 4's native atom RPC. |
| Next.js | `frontend/nextjs.md` | Deploy a Next.js app to AWS with AWS.Website.Nextjs — Next's own server on a Lambda Web Function with a shared S3 cache, S3 assets behind CloudFront, and next dev under alchemy dev. |
| Nuxt | `frontend/nuxt.md` | Deploy a Nuxt app to AWS with AWS.Website.Nuxt — the nitro server on a Lambda Web Function, S3 assets behind CloudFront, and Nuxt's own dev server under alchemy dev. |
| Octane | `frontend/octane.md` | Deploy an OctaneJS app to AWS with AWS.Website.Octane — SSR on a Lambda Web Function, assets on S3 + CloudFront, and Octane's own Vite dev server under alchemy dev. |
| React Router | `frontend/react-router.md` | Deploy React Router v8 (framework mode) to AWS with AWS.Website.ReactRouter — SSR on a Lambda Web Function, client assets on S3 + CloudFront, and React Router's own Vite dev server under alchemy dev. |
| SolidStart | `frontend/solidstart.md` | Deploy a SolidStart app to AWS with AWS.Website.SolidStart — SSR on a Lambda Web Function, S3 assets behind CloudFront, and SolidStart's own Vite dev server under alchemy dev. |
| Static sites | `frontend/static-site.md` | Ship a static site to S3 + CloudFront with AWS.Website.StaticSite — build-step support, Router composition, and cache invalidation on deploy. |
| SvelteKit | `frontend/sveltekit.md` | Deploy a SvelteKit app to AWS with AWS.Website.SvelteKit — SSR on a Lambda Web Function, assets and prerendered pages on S3 + CloudFront, and Kit's own dev server under alchemy dev. |
| TanStack Start | `frontend/tanstack-start.md` | Deploy TanStack Start (React or Solid) to AWS with AWS.Website.TanStackStart — SSR on a Lambda Web Function, client assets on S3 + CloudFront, and TanStack Start's own Vite dev server under alchemy dev. |
| Vinext | `frontend/vinext.md` | Deploy vinext to AWS with the shared Website API, native local development, and a platform-specific data cache. |
| React SPA | `frontend/vite-spa.md` | Deploy a React single-page app to AWS with AWS.Website.Vite — the Vite build on S3 + CloudFront, deep links answered by index.html out of the box, and Vite's own dev server under alchemy dev. |
| Vite | `frontend/vite.md` | Deploy a plain Vite app to AWS with AWS.Website.Vite — the vite build output on S3 behind CloudFront, SPA fallback at the edge, and Vite's own dev server under alchemy dev. |
| Vue | `frontend/vue.md` | Deploy a Vue single-page app to AWS with AWS.Website.Vite — S3 + CloudFront, deep links that work by default, and Vue's own Vite dev server under alchemy dev. |
| Waku | `frontend/waku.md` | Deploy a Waku app to AWS with AWS.Website.Waku — RSC server on a Lambda Web Function, SSG pages and assets on S3 + CloudFront, and Waku's own dev server under alchemy dev. |
| Websites | `frontend/websites.md` | Deploy Vite, Astro, Next.js, vinext, Nuxt, React Router, SvelteKit, TanStack Start, Waku, Octane, or any static build to AWS with first-class Website resources. |

## messaging/

| Page | File | Covers |
| --- | --- | --- |
| DynamoDB Streams | `messaging/dynamodb-streams.md` | How a DynamoDB Stream records every change to a table in order, what each change record carries, and how a Function consumes changes and checkpoints at the first failure. |
| EventBridge & Scheduler | `messaging/eventbridge.md` | How EventBridge buses route events to targets by matching their content, how runtimes publish and consume events, and how EventBridge Scheduler runs Functions, Queues and tasks on a schedule. |
| Kinesis | `messaging/kinesis.md` | How Kinesis Data Streams keep records in order per partition key across shards, how runtimes write records and consume them in batches, and how retention, replay and checkpoints work. |
| S3 events | `messaging/s3-events.md` | How a Bucket notifies a Function when objects are created or deleted, what each notification carries, and how to process notifications as an Effect Stream. |
| SNS | `messaging/sns.md` | How SNS Topics broadcast one message to every subscriber, how to publish from a runtime, subscribe Functions and Queues, and filter what each subscriber receives. |
| SQS | `messaging/sqs.md` | How SQS Queues hand work from producers to consumers, how visibility timeouts, retries and dead-letter queues keep messages from being lost, and how runtimes send to and consume from a Queue. |

## networking/

| Page | File | Covers |
| --- | --- | --- |
| VPC & networking | `networking/_overview.md` | How a VPC, its subnets, route tables, gateways and security groups decide what can reach what on AWS, which runtimes need one, and how to build one with the Network helper or by hand. |
| Custom domains | `networking/custom-domains.md` | How a domain reaches a site or API on AWS through a hosted zone, a TLS certificate and DNS records, and how the domain prop sets them up on Websites, Lambda Functions and load balancers. |

## observability/

| Page | File | Covers |
| --- | --- | --- |
| CloudWatch | `observability/cloudwatch.md` | How CloudWatch collects logs and metrics from every AWS service, and how alarms and dashboards declared next to your resources watch them. |

## security/

| Page | File | Covers |
| --- | --- | --- |
| Federated identity | `security/federated-identity.md` | How Cloud Run services and Fly Services reach AWS, and a Lambda reaches GCP, through workload identity federation instead of long-lived keys. |
| Secrets & env | `security/secrets-env.md` | How configuration and secrets reach a runtime on AWS, as environment variables from effect/Config or as Secrets Manager secrets read through a binding, and when to use each. |

## tutorial/

| Page | File | Covers |
| --- | --- | --- |
| Part 1: Your First Stack | `tutorial/part-1.md` | Install Alchemy, create a Stack with an AWS S3 Bucket, and deploy it. |
| Part 2: Add a Lambda | `tutorial/part-2.md` | Create an AWS Lambda Function with a public URL, bind the S3 Bucket, and implement GET/PUT routes. |
| Part 3: Testing | `tutorial/part-3.md` | Write integration tests that deploy your stack and make HTTP requests against your live Lambda Function URL. |
| Part 4: Stages | `tutorial/part-4.md` | Deploy isolated dev, staging, and prod instances of your stack with --stage, and tune resources per stage. |
| Part 5: CI/CD | `tutorial/part-5.md` | Set up GitHub Actions for automated AWS deployments and PR previews — with OIDC credentials provisioned as code. |
