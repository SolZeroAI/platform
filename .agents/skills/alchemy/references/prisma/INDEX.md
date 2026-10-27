# prisma index

29 pages. Prisma Postgres and Prisma Compute — projects, databases, connections, and deployed apps as Stack resources, with a zero-config local database in dev.

| Page | File | Covers |
| --- | --- | --- |
| Prisma | `_overview.md` | Prisma Postgres and Prisma Compute — projects, databases, connections, and deployed apps as Stack resources, with a zero-config local database in dev. |
| Setup | `setup.md` | Connect alchemy to Prisma — account, service tokens, and profiles. |

## compute/

| Page | File | Covers |
| --- | --- | --- |
| Apps | `compute/apps.md` | Prisma Compute apps as Stack resources — framework builds or Effect-native services, env wiring, custom domains, and a local dev command. |
| Deployments | `compute/deployments.md` | The fail-closed Compute deployment lifecycle — health-checked promotion, rollback recovery, old-generation cleanup, and env-only redeploys. |

## data/

| Page | File | Covers |
| --- | --- | --- |
| Branches | `data/branches.md` | Prisma branches group databases under git-style names — preview branches per stage, default-branch promotion, and database attachment. |
| Buckets | `data/buckets.md` | Prisma Buckets provision S3-compatible object storage inside a project, and Bucket access keys mint the S3 credentials — access key, one-time secret, endpoint, and the provider-side bucket name. |
| Connections | `data/connections.md` | Prisma Connections materialize database credentials — a conventional databaseUrl, direct and pooled connection strings, parsed origins for Hyperdrive, and the Connect runtime binding. |
| Drizzle Postgres on Prisma Compute | `data/drizzle-postgres.md` | Use Alchemy's Prisma hosting provider to run a Drizzle API against Prisma Postgres. |
| Postgres | `data/postgres.md` | Prisma Postgres as Stack resources — projects, databases, branch attachment, and a zero-config local database under alchemy dev. |

## frontend/

| Page | File | Covers |
| --- | --- | --- |
| Astro | `frontend/astro.md` | Deploy Astro SSR or a fully static site to Prisma Compute with Prisma.Website.Astro, running on Bun with native Astro dev locally. |
| Foldkit | `frontend/foldkit.md` | Deploy Foldkit to Prisma Compute with Prisma.Website.Foldkit — a Vite SPA served on Bun, deep-link fallback, and native HMR locally. |
| Next.js | `frontend/nextjs.md` | Deploy Next.js to Prisma Compute with Prisma.Website.Nextjs — a normal Next server on Bun, not OpenNext, and next dev locally. |
| Nuxt | `frontend/nuxt.md` | Deploy Nuxt to Prisma Compute with Prisma.Website.Nuxt — Nitro's Node target running on Bun and Nuxt's own dev server locally. |
| Octane | `frontend/octane.md` | Deploy OctaneJS to Prisma Compute with Prisma.Website.Octane — the Node target on Bun, SSR plus client assets, and native Vite dev locally. |
| React Router | `frontend/react-router.md` | Deploy React Router v7 framework apps to Prisma Compute with Prisma.Website.ReactRouter — SSR on Bun and native Vite dev locally. |
| SolidStart | `frontend/solidstart.md` | Deploy SolidStart to Prisma Compute with Prisma.Website.SolidStart — Nitro's Node target on Bun and SolidStart's native Vite dev server locally. |
| Static sites | `frontend/static-site.md` | Deploy any static build to Prisma Compute with Prisma.Website.StaticSite — a shell command, output directory, and Bun static-file server. |
| SvelteKit | `frontend/sveltekit.md` | Deploy SvelteKit to Prisma Compute with Prisma.Website.SvelteKit — SSR and prerendered assets on Bun, with native Vite dev locally. |
| TanStack Start | `frontend/tanstack-start.md` | Deploy TanStack Start to Prisma Compute with Prisma.Website.TanStackStart — React or Solid SSR on Bun, with native Vite dev locally. |
| Vinext | `frontend/vinext.md` | Deploy vinext to Prisma Compute with the shared Website API, native local development, and traced runtime dependencies. |
| Vite | `frontend/vite.md` | Deploy a Vite SPA to Prisma Compute with Prisma.Website.Vite — static files served on Bun and Vite's native dev server locally. |
| Vocs | `frontend/vocs.md` | Deploy Vocs documentation to Prisma Compute with Prisma.Website.Vocs — static assets and Waku RSC on Bun, with Vocs dev locally. |
| Waku | `frontend/waku.md` | Deploy Waku to Prisma Compute with Prisma.Website.Waku — React Server Components and static pages on Bun, with Waku's native dev server locally. |
| Websites | `frontend/websites.md` | Deploy Vite, Astro, Next.js, Nuxt, React Router, SolidStart, SvelteKit, TanStack Start, Waku, Octane, Foldkit, Vocs, or any static build to Prisma Compute. |

## guides/

| Page | File | Covers |
| --- | --- | --- |
| Connect from Cloudflare Workers | `guides/cloudflare-workers.md` | Two ways to reach Prisma Postgres from a Worker — the Connect binding for credentials, or Hyperdrive in front of the direct origin for edge-pooled SQL. |

## tutorial/

| Page | File | Covers |
| --- | --- | --- |
| Part 1: Your First Project | `tutorial/part-1.md` | Install Alchemy, configure Prisma credentials, and deploy your first Project. |
| Part 2: An HTTP API | `tutorial/part-2.md` | Deploy an Effect-native Prisma Compute service and add an HTTP health endpoint. |
| Part 3: Query Postgres | `tutorial/part-3.md` | Create Prisma Postgres, bind its connection to Compute, and query it with Effect SQL. |
| Part 4: A Vite Frontend | `tutorial/part-4.md` | Connect a Vite frontend to your Prisma API, develop locally, and destroy the tutorial resources. |
