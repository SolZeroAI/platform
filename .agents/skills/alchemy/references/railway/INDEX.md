# railway index

36 pages. Deploy Effect programs to Railway as Projects, Services, databases, Volumes, and Buckets.

| Page | File | Covers |
| --- | --- | --- |
| Railway | `_overview.md` | Deploy Effect programs to Railway as Projects, Services, databases, Volumes, and Buckets. |
| Custom domains, TCP & private networks | `networking.md` | Reach a Railway Service on your own hostname, expose databases over public TCP, and name private-mesh DNS. |
| Setup | `setup.md` | Create a Railway workspace, generate an account API token, and store it in a profile. |

## compute/

| Page | File | Covers |
| --- | --- | --- |
| Environments | `compute/environments.md` | Extra deploy environments under a Project. Production is created with the Project — do not duplicate it. |
| Functions, templates & VMs | `compute/functions.md` | Effect-native canvas Functions, marketplace templates, sandboxes, and cloud agents on Railway. |
| Projects | `compute/projects.md` | A workspace-scoped namespace containing Services, Environments, Volumes, Variables, and Buckets. |
| Regions | `compute/regions.md` | Where Railway Services, Volumes, Postgres, and Buckets live. |
| Services | `compute/services.md` | A container in a Railway Project — a public image, or an Effect program Railway builds from a generated Dockerfile. |

## data/

| Page | File | Covers |
| --- | --- | --- |
| Buckets | `data/buckets.md` | S3-compatible object storage in a Project. Bind Railway.PutObject / Railway.GetObject. |
| Drizzle MySQL on Railway | `data/drizzle-mysql.md` | Connect an Effect-native Railway Service to MySQL and deploy committed Drizzle migrations. |
| Drizzle Postgres on Railway | `data/drizzle-postgres.md` | Query Railway Postgres from an Effect-native Service and apply reviewed Drizzle migrations separately. |
| Mongo | `data/mongo.md` | Official MongoDB in a Project. Bind Railway.ConnectMongo and ping with the MongoDB driver. |
| MySQL | `data/mysql.md` | Official MySQL in a Project. Bind Railway.ConnectMySQL and query with Drizzle or SQL. |
| Postgres | `data/postgres.md` | Official SSL Postgres in a Project. Bind Railway.ConnectPostgres and query with Drizzle or SQL. |
| Redis | `data/redis.md` | Redis in a Project. Bind Railway.ReadRedis / WriteRedis / ReadWriteRedis on a Service. |
| Variables | `data/variables.md` | Config.Redacted on a Service, Railway.Variable when Railway should own the value. |
| Volumes | `data/volumes.md` | Block disk in a Project. Mount it into a Service with MountVolume. |

## frontend/

| Page | File | Covers |
| --- | --- | --- |
| Astro | `frontend/astro.md` | Deploy an Astro app to Railway with Railway.Website.Astro — Node SSR on a Service container, static output as a file server, and Astro's own dev server under alchemy dev. |
| Foldkit | `frontend/foldkit.md` | Deploy a Foldkit app to Railway with Railway.Website.Foldkit — a client-only Vite SPA on a container Service, and Vite's own dev server under alchemy dev. |
| Next.js | `frontend/nextjs.md` | Deploy a Next.js app to Railway with Railway.Website.Nextjs — next build plus a Node next({ dev: false }) container, and next dev under alchemy dev. |
| Nuxt | `frontend/nuxt.md` | Deploy a Nuxt app to Railway with Railway.Website.Nuxt — nitro's node preset on a Service, and Nuxt's own dev server under alchemy dev. |
| Octane | `frontend/octane.md` | Deploy an OctaneJS app to Railway with Railway.Website.Octane — SSR plus client assets on one Service, and Octane's own Vite dev server under alchemy dev. |
| React Router | `frontend/react-router.md` | Deploy React Router v7 (framework mode) to Railway with Railway.Website.ReactRouter — SSR on a container Service, client assets in the image, and React Router's own Vite dev server under alchemy dev. |
| SolidStart | `frontend/solidstart.md` | Deploy a SolidStart app to Railway with Railway.Website.SolidStart — nitro's node preset on a container Service, prerendered pages in the image, and SolidStart's own Vite dev server under alchemy dev. |
| Static sites | `frontend/static-site.md` | Deploy a static site to Railway with Railway.Website.StaticSite — a build command, a container Service. |
| SvelteKit | `frontend/sveltekit.md` | Deploy a SvelteKit app to Railway with Railway.Website.SvelteKit — kit SSR plus prerendered assets on one Service, and Kit's own dev server under alchemy dev. |
| TanStack Start | `frontend/tanstack-start.md` | Deploy TanStack Start (React or Solid) to Railway with Railway.Website.TanStackStart — SSR on a container Service, client assets in the image, and TanStack Start's own Vite dev server under alchemy dev. |
| Vinext | `frontend/vinext.md` | Deploy vinext to Railway with the shared Website API, native local development, and a platform-specific data cache. |
| Vite | `frontend/vite.md` | Deploy a Vite SPA to Railway with Railway.Website.Vite — static assets on a container Service, a *.up.railway.app URL (or your domain), and Vite's own dev server under alchemy dev. |
| Vocs | `frontend/vocs.md` | Deploy a Vocs docs site to Railway with Railway.Website.Vocs — prerendered HTML on a Railway Service, extensionless routes, and Vocs' own dev server under alchemy dev. |
| Waku | `frontend/waku.md` | Deploy a Waku app to Railway with Railway.Website.Waku — RSC server on a container Service, SSG pages in the image, and Waku's own dev server under alchemy dev. |
| Websites | `frontend/websites.md` | Deploy Vite, Astro, Next.js, vinext, Nuxt, React Router, SolidStart, SvelteKit, TanStack Start, Waku, Octane, Foldkit, Vocs, or any static build to Railway with first-class Website resources. |

## tutorial/

| Page | File | Covers |
| --- | --- | --- |
| Part 1: Your First Project | `tutorial/part-1.md` | Install Alchemy, create a Stack with a Railway Project, and deploy it. |
| Part 2: Deploy a Service | `tutorial/part-2.md` | Bundle an Effect HTTP server, deploy it to Railway as a Service, and serve requests on up.railway.app. |
| Part 3: Persist Data with a Volume | `tutorial/part-3.md` | Mount a Railway disk into your Service with MountVolume and store files that survive deploys. |
| Part 4: Variables and Cleanup | `tutorial/part-4.md` | Store a Project variable, read it from the Service at runtime, and destroy the stack. |
