# neon index

31 pages. Declare Neon Postgres, Functions, storage, Auth, AI Gateway and websites together in an Alchemy Stack.

| Page | File | Covers |
| --- | --- | --- |
| Neon | `_overview.md` | Declare Neon Postgres, Functions, storage, Auth, AI Gateway and websites together in an Alchemy Stack. |
| Organization governance | `governance.md` | Manage existing Neon organization access, billing alerts, and private-network associations with explicit ownership and restoration. |
| Setup | `setup.md` | Prepare Neon credentials, service access, regions, and external dependencies before deploying with Alchemy. |

## data/

| Page | File | Covers |
| --- | --- | --- |
| Branching | `data/branching.md` | Neon branches are copy-on-write forks of a parent branch — create them per stage or preview, pin them to a point in time, copy schema only, and let them expire on their own. |
| Connections | `data/connections.md` | Every Neon project and branch exposes direct and pooled connection URIs plus pre-parsed origin outputs — feed the direct origin to Hyperdrive and the pooled one to everything else. |
| Migrations | `data/migrations.md` | Apply SQL migrations and seed data to Neon projects and branches as part of every deploy — ordered, hashed, and tracked in Alchemy's __alchemy_migrations table. |

## frontend/

| Page | File | Covers |
| --- | --- | --- |
| Astro | `frontend/astro.md` | Package Astro SSR or prerendered pages for Neon Functions, with native Astro development. |
| Foldkit | `frontend/foldkit.md` | Package a client-only Foldkit Vite app for Neon Functions with SPA routing. |
| Next.js | `frontend/nextjs.md` | Build Next.js for a Neon Function Fetch entry and use next dev locally. |
| Nuxt | `frontend/nuxt.md` | Package Nuxt SSR and public assets for Neon Functions, with native Nuxt development. |
| Octane | `frontend/octane.md` | Package Octane rendering and server routes as a Neon Function Fetch artifact. |
| React Router | `frontend/react-router.md` | Package React Router framework-mode SSR and browser assets for Neon Functions. |
| SolidStart | `frontend/solidstart.md` | Package SolidStart SSR and prerendered assets for a Neon Function Fetch entry. |
| Static Site | `frontend/static-site.md` | Run a static-site build command and package its output for a Neon Function. |
| SvelteKit | `frontend/sveltekit.md` | Package SvelteKit SSR and prerendered assets as a Neon Function Fetch artifact. |
| TanStack Start | `frontend/tanstack-start.md` | Package TanStack Start SSR and client assets for Neon Functions, with native Vite development. |
| Vite | `frontend/vite.md` | Package a Vite client build as a Neon Function, with native Vite development. |
| Vocs | `frontend/vocs.md` | Package Vocs documentation and its Waku RSC handler for Neon Functions. |
| Waku | `frontend/waku.md` | Package Waku RSC and static pages for Neon Functions, with native Waku development. |

## guides/

| Page | File | Covers |
| --- | --- | --- |
| AI Gateway setup | `guides/ai-gateway.md` | Buy Neon AI Gateway credits and use a model from an Effect Function. |
| Custom domains | `guides/custom-domains.md` | Register a Function hostname, configure DNS and CAA, verify HTTPS, and retire the domain safely. |
| Drizzle ORM with Neon | `guides/drizzle.md` | Configure Neon projects, branches, committed Drizzle migrations, and direct or pooled connections. |
| Preview branches per PR | `guides/preview-branches.md` | Keep one long-lived Neon project in a staging stage and fork a copy-on-write branch per PR stage — isolated preview databases in seconds, destroyed with the stage. |
| Private networking | `guides/private-networking.md` | Prepare AWS PrivateLink endpoints, register them with Neon, enable private DNS, and verify database access. |
| Production Auth | `guides/production-auth.md` | Configure trusted origins, SMTP, OAuth callbacks, and verification before launching Managed Better Auth. |
| State and recovery | `guides/state-recovery.md` | Preserve Neon ownership and reveal-once secrets, recover interrupted deployments, and clean up without discarding state. |

## tutorial/

| Page | File | Covers |
| --- | --- | --- |
| Build an upload journal | `tutorial/_overview.md` | Sign in, upload private files, process real storage events, and view Postgres-backed status with Neon and Alchemy. |
| Create the upload backend | `tutorial/backend.md` | Add a Neon project, a migrated branch, private storage, and managed authentication. |
| Connect the browser | `tutorial/frontend.md` | Use managed signup and sessions to upload and download private files from Vite. |
| Protect and process uploads | `tutorial/functions.md` | Verify JWTs, sign private uploads, and record real bucket events in Postgres. |
| Fork a preview and clean up | `tutorial/previews.md` | Keep preview writes isolated from the parent, verify inheritance, and destroy only owned resources. |
