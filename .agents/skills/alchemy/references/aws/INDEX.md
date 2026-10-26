# aws index

54 pages. Build AWS applications with Alchemy — a runtime (usually Lambda) plus typed resources, wired together by bindings that mint least-privilege IAM policies.

| Page | File | Covers |
| --- | --- | --- |
| AWS | `_overview.md` | Build AWS applications with Alchemy — a runtime (usually Lambda) plus typed resources, wired together by bindings that mint least-privilege IAM policies. |
| Local development | `local-development.md` | alchemy dev runs your AWS stack on your machine — Lambda in Docker containers, local S3/DynamoDB/SQS, event sources firing, hot reload — with no AWS account or credentials required. |
| Setup | `setup.md` | Connect Alchemy to AWS with SSO, stored access keys, or CI environment credentials. |

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
| Choosing a runtime | `compute/choosing-a-runtime.md` | Lambda vs ECS vs EKS vs EC2 for Alchemy apps — cold starts, cost shape, packaging, and how much of each Alchemy currently covers. |
| EC2 | `compute/ec2.md` | Launch virtual machines with the Instance resource — as a raw compute primitive, or hosting a bundled long-lived Effect program served straight off the box. |
| ECS | `compute/ecs.md` | Run containers on AWS with ECS and Fargate — Task definitions that run to completion, Services that keep containers running behind a load balancer, with images bundled from an Effect program, built from your Dockerfile, or mirrored from a registry. |
| EKS | `compute/eks.md` | Stand up an EKS Auto Mode cluster on a Network and run containers on it — Deployments for servers, Jobs for run-to-completion work, Manifests for everything else. No YAML, no kubectl. |
| HyperPod | `compute/hyperpod.md` | Provision SageMaker HyperPod clusters — Slurm or EKS orchestrated — and run ML workloads on them with sbatch, raw manifests, or effectful Jobs with task governance. |
| Lambda | `compute/lambda.md` | Stand up an AWS Lambda Function from a single Effect, expose it over a Function URL, and call it from a test. |
| Lambda MicroVMs | `compute/microvms.md` | Build a Firecracker MicroVM image from TypeScript or a Dockerfile, then launch and drive isolated stateful instances from a Lambda Function with typed lifecycle bindings and RPC. |

## data/

| Page | File | Covers |
| --- | --- | --- |
| Drizzle + Aurora PostgreSQL | `data/drizzle-aurora.md` | Drizzle on Lambda with private Aurora PostgreSQL, IAM authentication, verified TLS, and reviewed SQL migrations. |
| Drizzle + Aurora DSQL | `data/drizzle-dsql.md` | Drizzle on Lambda with Aurora DSQL, a non-admin database role, verified TLS, and an explicit DSQL migration boundary. |
| DynamoDB | `data/dynamodb.md` | Add a DynamoDB Table, bind GetItem and PutItem to your Lambda, and serve a typed key/value HTTP API backed by DynamoDB. |
| RDS & Aurora | `data/rds.md` | Stand up an Aurora cluster in one call with the Aurora helper, connect from Lambda over the Connect binding with pg, or skip connections entirely with the Data API. |
| S3 | `data/s3.md` | Add an S3 Bucket to your Stack, bind PutObject and GetObject as runtime capabilities, and let Alchemy mint the IAM policy for you. |

## email/

| Page | File | Covers |
| --- | --- | --- |
| Email receiving | `email/receiving.md` | Receive inbound email with SES — rule sets and rules that store mail in S3, fan out to SNS, invoke a Lambda, or bounce it, plus IP filters and the active rule set pointer. |
| Sending & managing email | `email/sending.md` | Send email with SES — verify identities, send from a Lambda with the SendEmail binding, manage contact lists, tenants, dedicated IP pools, account settings, and deliverability insights. |

## frontend/

| Page | File | Covers |
| --- | --- | --- |
| Astro | `frontend/astro.md` | Deploy an Astro app to AWS with AWS.Website.Astro — SSR on a streaming Lambda Function URL, static output on S3 + CloudFront, and Astro's own dev server under alchemy dev. |
| Foldkit | `frontend/foldkit.md` | Deploy a Foldkit app to AWS with AWS.Website.Foldkit — the client build on S3 + CloudFront, SPA deep links by default, and Foldkit's own Vite dev server under alchemy dev. |
| Full-stack TanStack Start + RPC + Drizzle | `frontend/full-stack-tanstack-rpc-drizzle.md` | Build a reactive full-stack app on AWS — a TanStack Start UI on CloudFront and Lambda that drives an Effect RPC Lambda over Drizzle and Aurora DSQL, with browser state wired through Effect 4's native atom RPC. |
| Next.js | `frontend/nextjs.md` | Deploy a Next.js app to AWS with AWS.Website.Nextjs — the OpenNext serverless topology with streaming SSR, image optimization, and ISR wiring, plus next dev under alchemy dev. |
| Nuxt | `frontend/nuxt.md` | Deploy a Nuxt app to AWS with AWS.Website.Nuxt — nitro's aws-lambda preset on a streaming Lambda Function URL, S3 assets behind CloudFront, and Nuxt's own dev server under alchemy dev. |
| Octane | `frontend/octane.md` | Deploy an OctaneJS app to AWS with AWS.Website.Octane — SSR on a streaming Lambda Function URL, assets on S3 + CloudFront, and Octane's own Vite dev server under alchemy dev. |
| React Router | `frontend/react-router.md` | Deploy React Router v7 (framework mode) to AWS with AWS.Website.ReactRouter — SSR on a streaming Lambda Function URL, client assets on S3 + CloudFront, and React Router's own Vite dev server under alchemy dev. |
| SolidStart | `frontend/solidstart.md` | Deploy a SolidStart app to AWS with AWS.Website.SolidStart — nitro's aws-lambda preset on a streaming Lambda Function URL, S3 assets behind CloudFront, and SolidStart's own Vite dev server under alchemy dev. |
| Static sites | `frontend/static-site.md` | Ship a static site to S3 + CloudFront with AWS.Website.StaticSite — build-step support, Router composition, and cache invalidation on deploy. |
| SvelteKit | `frontend/sveltekit.md` | Deploy a SvelteKit app to AWS with AWS.Website.SvelteKit — SSR on a streaming Lambda Function URL, assets and prerendered pages on S3 + CloudFront, and Kit's own dev server under alchemy dev. |
| TanStack Start | `frontend/tanstack-start.md` | Deploy TanStack Start (React or Solid) to AWS with AWS.Website.TanStackStart — SSR on a streaming Lambda Function URL, client assets on S3 + CloudFront, and TanStack Start's own Vite dev server under alchemy dev. |
| Vinext | `frontend/vinext.md` | Deploy vinext to AWS with the shared Website API, native local development, and a platform-specific data cache. |
| React SPA | `frontend/vite-spa.md` | Deploy a React single-page app to AWS with AWS.Website.Vite — the Vite build on S3 + CloudFront, deep links answered by index.html out of the box, and Vite's own dev server under alchemy dev. |
| Vite | `frontend/vite.md` | Deploy a plain Vite app to AWS with AWS.Website.Vite — the vite build output on S3 behind CloudFront, SPA fallback at the edge, and Vite's own dev server under alchemy dev. |
| Vue | `frontend/vue.md` | Deploy a Vue single-page app to AWS with AWS.Website.Vite — S3 + CloudFront, deep links that work by default, and Vue's own Vite dev server under alchemy dev. |
| Waku | `frontend/waku.md` | Deploy a Waku app to AWS with AWS.Website.Waku — RSC server on a streaming Lambda Function URL, SSG pages and assets on S3 + CloudFront, and Waku's own dev server under alchemy dev. |
| Websites | `frontend/websites.md` | Deploy Vite, Astro, Next.js, vinext, Nuxt, React Router, SvelteKit, TanStack Start, Waku, Octane, or any static build to AWS with first-class Website resources. |

## messaging/

| Page | File | Covers |
| --- | --- | --- |
| Process DynamoDB Streams | `messaging/dynamodb-streams.md` | Enable a DynamoDB Stream on your table and consume change records as a typed Effect Stream from the same Lambda. |
| EventBridge & Scheduler | `messaging/eventbridge.md` | Route application and AWS events through EventBridge buses and rules, consume them in Lambda as typed streams, and run cron/rate schedules against Lambda, SQS, and ECS with EventBridge Scheduler. |
| Kinesis | `messaging/kinesis.md` | Add a Kinesis Data Stream, publish records from one Lambda, and consume them in order from another — wired through the same Stream-shaped event source. |
| React to S3 Events | `messaging/s3-events.md` | Subscribe a Lambda Function to S3 bucket notifications, process them as an Effect Stream, and let Alchemy wire up the IAM and event-source plumbing. |
| SNS | `messaging/sns.md` | Create an SNS Topic, publish to it from a Lambda with the Publish binding, fan messages out to SQS queues, and consume notifications as a typed Stream. |
| SQS | `messaging/sqs.md` | Add an SQS Queue, publish messages from your Lambda, and consume them from a second consumer Lambda — all wired through Alchemy bindings. |

## networking/

| Page | File | Covers |
| --- | --- | --- |
| VPC & networking | `networking/_overview.md` | The Network helper for a production-shaped VPC in one call, and the full set of EC2 networking primitives — VPCs, subnets, gateways, routes, security groups, and endpoints — for explicit control. |
| Custom domains with Route53 + ACM | `networking/custom-domains.md` | Serve your site or API from your own domain — DNS-validated ACM certificates, Route 53 alias records, and the domain prop on Website resources. |

## observability/

| Page | File | Covers |
| --- | --- | --- |
| CloudWatch | `observability/cloudwatch.md` | Declare CloudWatch dashboards as structured widget documents and metric alarms that fire SNS topics — versioned next to the Lambda functions and queues they observe. |

## security/

| Page | File | Covers |
| --- | --- | --- |
| Secrets & env | `security/secrets-env.md` | Deliver API keys from .env to a Lambda with effect/Config, and graduate to AWS Secrets Manager when the secret is a shared, generated, or rotated cloud resource. |

## tutorial/

| Page | File | Covers |
| --- | --- | --- |
| Part 1: Your First Stack | `tutorial/part-1.md` | Install Alchemy, create a Stack with an AWS S3 Bucket, and deploy it. |
| Part 2: Add a Lambda | `tutorial/part-2.md` | Create an AWS Lambda Function with a public URL, bind the S3 Bucket, and implement GET/PUT routes. |
| Part 3: Testing | `tutorial/part-3.md` | Write integration tests that deploy your stack and make HTTP requests against your live Lambda Function URL. |
| Part 4: Stages | `tutorial/part-4.md` | Deploy isolated dev, staging, and prod instances of your stack with --stage, and tune resources per stage. |
| Part 5: CI/CD | `tutorial/part-5.md` | Set up GitHub Actions for automated AWS deployments and PR previews — with OIDC credentials provisioned as code. |
