# fly index

35 pages. Deploy Effect programs to Fly.io as Apps, Machines, Services, and Sprites.

| Page | File | Covers |
| --- | --- | --- |
| Fly | `_overview.md` | Deploy Effect programs to Fly.io as Apps, Machines, Services, and Sprites. |
| IPs & certificates | `networking.md` | Public and private Fly Services, App addresses, and certificates for your own hostname. |
| Setup | `setup.md` | Create a Fly org, generate an API token, and store it in a profile. |

## compute/

| Page | File | Covers |
| --- | --- | --- |
| Apps | `compute/apps.md` | A global namespace containing Machines, Services, Secrets, IPs, and certificates. |
| Connect Services | `compute/connecting-services.md` | Build several Fly Services that call each other's methods over a private network, behind one public entry point. |
| Blue/green deployments | `compute/deployments.md` | Deploy a new version, check it before serving traffic, and give the old version time to finish work. |
| Machines | `compute/machines.md` | A Firecracker VM running a container image. |
| Regions | `compute/regions.md` | Where Fly Machines, Volumes, Postgres, and Redis live. Alchemy defaults to iad. |
| Services | `compute/services.md` | An Effect program running in Fly Machines in its own Fly App. Scale it with count. |
| Sprites | `compute/sprites.md` | An Effect program running in a Fly.io Sprite. It hibernates when idle. |

## data/

| Page | File | Covers |
| --- | --- | --- |
| Drizzle Postgres on Fly | `data/drizzle-postgres.md` | Connect a Fly Service to Managed Postgres and deploy reviewed Drizzle migrations. |
| Postgres | `data/postgres.md` | A billed Managed Postgres cluster. Bind Fly.ConnectPostgres and query with Drizzle or SQL. |
| Redis | `data/redis.md` | Managed Upstash Redis. Bind Fly.ReadRedis / WriteRedis / ReadWriteRedis on a Service. |
| Secrets | `data/secrets.md` | Config.Redacted on a Service, Fly.Secret when Fly should own the value, and KMS keys. |
| Tigris | `data/tigris.md` | S3-compatible object storage billed through Fly. Bind Fly.PutObject / Fly.GetObject. |
| Volumes | `data/volumes.md` | A disk in one region, attached to one Machine. |

## frontend/

| Page | File | Covers |
| --- | --- | --- |
| Astro | `frontend/astro.md` | Deploy an Astro app to Fly with Fly.Website.Astro — Node SSR on a Machine, static output as a file server, and Astro's own dev server under alchemy dev. |
| Foldkit | `frontend/foldkit.md` | Deploy a Foldkit app to Fly with Fly.Website.Foldkit — a client-only Vite SPA on a Node static-file Service, fly.dev over shared IPv4, and Vite's own dev server under alchemy dev. |
| Next.js | `frontend/nextjs.md` | Deploy a Next.js app to Fly with Fly.Website.Nextjs — next build plus a Node next({ dev: false }) Machine, and next dev under alchemy dev. |
| Nuxt | `frontend/nuxt.md` | Deploy a Nuxt app to Fly with Fly.Website.Nuxt — nitro's node preset on a Machine, assets baked into the image, and Nuxt's own dev server under alchemy dev. |
| Octane | `frontend/octane.md` | Deploy an OctaneJS app to Fly with Fly.Website.Octane — SSR on a Machine, client assets baked into the image, and Octane's own Vite dev server under alchemy dev. |
| React Router | `frontend/react-router.md` | Deploy React Router v7 (framework mode) to Fly with Fly.Website.ReactRouter — SSR on a Machine, client assets baked into the image, and React Router's own Vite dev server under alchemy dev. |
| SolidStart | `frontend/solidstart.md` | Deploy a SolidStart app to Fly with Fly.Website.SolidStart — nitro's node preset on a Machine, prerendered pages baked into the image, and SolidStart's own Vite dev server under alchemy dev. |
| Static sites | `frontend/static-site.md` | Deploy a static site to Fly with Fly.Website.StaticSite — a build command, a Node static-file server on a Machine, and https://{app}.fly.dev (or your hostname) on deploy. |
| SvelteKit | `frontend/sveltekit.md` | Deploy a SvelteKit app to Fly with Fly.Website.SvelteKit — kit SSR on a Machine, prerendered assets baked into the image, and Kit's own dev server under alchemy dev. |
| TanStack Start | `frontend/tanstack-start.md` | Deploy TanStack Start (React or Solid) to Fly with Fly.Website.TanStackStart — SSR on a Machine, client assets baked into the image, and TanStack Start's own Vite dev server under alchemy dev. |
| Vinext | `frontend/vinext.md` | Deploy vinext to Fly with the shared Website API, native local development, and a platform-specific data cache. |
| Vite | `frontend/vite.md` | Deploy a Vite SPA to Fly with Fly.Website.Vite — static assets on a Node Machine, fly.dev (or your domain) over HTTPS, and Vite's own dev server under alchemy dev. |
| Vocs | `frontend/vocs.md` | Deploy a Vocs docs site to Fly with Fly.Website.Vocs — prerendered HTML on a Node static-file server, extensionless routes, and Vocs' own dev server under alchemy dev. |
| Waku | `frontend/waku.md` | Deploy a Waku app to Fly with Fly.Website.Waku — RSC server on a Machine, SSG pages baked into the image, and Waku's own dev server under alchemy dev. |
| Websites | `frontend/websites.md` | Deploy Vite, Astro, Next.js, vinext, Nuxt, React Router, SolidStart, SvelteKit, TanStack Start, Waku, Octane, Foldkit, Vocs, or any static build to Fly with first-class Website resources. |

## tutorial/

| Page | File | Covers |
| --- | --- | --- |
| Part 1: Your First Service | `tutorial/part-1.md` | Install Alchemy, create a Stack, and deploy an Effect HTTP Service to Fly on its own fly.dev hostname. |
| Part 2: Configure the Service | `tutorial/part-2.md` | Pin the Service's region and port, add a health route, and ship a code change. |
| Part 3: Persist Data with a Volume | `tutorial/part-3.md` | Mount a Fly disk into your Service with MountVolume and store files that survive deploys. |
| Part 4: Secrets and Cleanup | `tutorial/part-4.md` | Read a secret from .env in the Service with Config.Redacted, guard a route with it, and destroy the stack. |
