# better-auth index

28 pages. Build authentication with an Effect service, automatic database bindings, and deploy-time migrations.

| Page | File | Covers |
| --- | --- | --- |
| Better Auth | `_overview.md` | Build authentication with an Effect service, automatic database bindings, and deploy-time migrations. |

## databases/

| Page | File | Covers |
| --- | --- | --- |
| Choose a database | `databases/_overview.md` | Choose a Better Auth database layer with a complete, standalone integration example. |
| Aurora Data API | `databases/aurora-data-api.md` | Deploy a Better Auth Lambda with Aurora PostgreSQL over HTTPS and automatic IAM bindings. |
| Cloudflare D1 | `databases/cloudflare-d1.md` | Deploy a Better Auth Worker with a native D1 database and automatic schema migrations. |
| Cloudflare Hyperdrive | `databases/cloudflare-hyperdrive.md` | Deploy a Better Auth Worker with an uncached Hyperdrive connection to a Neon Postgres origin. |
| Drizzle | `databases/drizzle.md` | Generate a Relations v2 auth schema and deploy a Better Auth Lambda with a request-scoped raw Drizzle database. |
| Memory | `databases/memory.md` | Run a disposable Better Auth Worker with an isolate-local memory store. |
| MySQL | `databases/mysql.md` | Deploy Better Auth on Lambda with an existing MySQL database and a request-scoped mysql2 pool. |
| Neon | `databases/neon.md` | Deploy a Better Auth Worker with a Neon project and the serverless database driver. |
| Postgres | `databases/postgres.md` | Deploy Better Auth on Lambda with an existing PostgreSQL database and a request-scoped pg pool. |
| SQLite | `databases/sqlite.md` | Run Better Auth in a local Bun server with a persistent SQLite file. |

## guides/

| Page | File | Covers |
| --- | --- | --- |
| Config and secrets | `guides/configuration.md` | Bind Effect Config into an Alchemy host, compose database layers, and preserve generated signing secrets. |
| HTTP API middleware | `guides/http-api-middleware.md` | Authenticate each request and provide a typed current user to Effect HTTP API handlers. |
| Migrations | `guides/migrations.md` | Apply Better Auth schema changes at deploy, or manage the schema yourself. |
| Secondary storage | `guides/secondary-storage.md` | Supply a strongly consistent session and rate-limit store through an Effect layer. |

## sign-in-providers/

| Page | File | Covers |
| --- | --- | --- |
| Sign-in providers | `sign-in-providers/_overview.md` | Choose a standalone sign-in walkthrough for your existing Alchemy project. |
| Custom OAuth and OIDC | `sign-in-providers/custom-oauth.md` | Add Keycloak OIDC sign-in to an Alchemy Worker with D1, one small step at a time. |
| Email and password | `sign-in-providers/email-password.md` | Add D1-backed registration, real email verification, and password recovery to an Alchemy project. |
| GitHub | `sign-in-providers/github.md` | Add GitHub sign-in to a D1-backed Alchemy Worker, one step at a time. |
| Google | `sign-in-providers/google.md` | Add Google sign-in to a D1-backed Alchemy Worker, one step at a time. |
| Microsoft | `sign-in-providers/microsoft.md` | Add Microsoft sign-in to an Alchemy Worker with D1, one small step at a time. |

## tutorial/

| Page | File | Covers |
| --- | --- | --- |
| Part 1: Create an Auth service | `tutorial/part-1.md` | Install Better Auth, provide a D1 database layer, and create an Effect service. |
| Part 2: Mount the HTTP API | `tutorial/part-2.md` | Serve Better Auth routes and an Effect HTTP API from the same Worker. |
| Part 3: Build sign-in | `tutorial/part-3.md` | Add a same-origin browser client with sign-up, sign-in, session lookup, and sign-out. |
| Part 4: Protect API endpoints | `tutorial/part-4.md` | Resolve the session in Effect HTTP API middleware and provide a typed CurrentUser service. |
| Part 5: Add GitHub sign-in | `tutorial/part-5.md` | Register a GitHub OAuth app, bind its credentials through Effect Config, and sign in from the browser. |
| Part 6: Deploy and verify | `tutorial/part-6.md` | Deploy the authenticated API, configure production OAuth callbacks, and verify session boundaries. |

## upgrades/

| Page | File | Covers |
| --- | --- | --- |
| Upgrading from 1.6 to 1.7.5 or newer | `upgrades/from-1-6-to-1-7.md` | Upgrade Better Auth directly from 1.6, preserve existing users, and update your schema and application APIs. |
