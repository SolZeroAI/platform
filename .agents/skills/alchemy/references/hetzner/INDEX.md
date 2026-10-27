# hetzner index

27 pages. Build applications on Hetzner Cloud with Alchemy — Servers running your Effect programs as Services, plus volumes, networks, firewalls, load balancers, and DNS, all in one typed program.

| Page | File | Covers |
| --- | --- | --- |
| Hetzner | `_overview.md` | Build applications on Hetzner Cloud with Alchemy — Servers running your Effect programs as Services, plus volumes, networks, firewalls, load balancers, and DNS, all in one typed program. |
| Setup | `setup.md` | Install Alchemy and connect it to Hetzner Cloud — create a project, generate an API token, and store it in a profile. |

## compute/

| Page | File | Covers |
| --- | --- | --- |
| Servers | `compute/servers.md` | Launch Hetzner Cloud Servers with Alchemy — SSH keys and typed SSH access, cloud-init, networks, volumes, snapshots, and placement groups. |
| Services | `compute/services.md` | Deploy Effect programs to Hetzner Servers as supervised systemd units — HTTP handlers, background workers, env & config, updates, and logs. |

## data/

| Page | File | Covers |
| --- | --- | --- |
| Drizzle Postgres on Hetzner | `data/drizzle-postgres.md` | Run a Drizzle API on a Hetzner Server with external Neon Postgres and reviewed SQL migrations. |
| Volumes | `data/volumes.md` | Durable network block storage for Hetzner Servers — attach with props or VolumeAttachment, mount into Services with the MountVolume binding. |

## frontend/

| Page | File | Covers |
| --- | --- | --- |
| Astro | `frontend/astro.md` | Deploy an Astro app to Hetzner with Hetzner.Website.Astro — Node SSR as a systemd unit on a Server, static output as a file server, and Astro's own dev server under alchemy dev. |
| Foldkit | `frontend/foldkit.md` | Deploy a Foldkit app to Hetzner with Hetzner.Website.Foldkit — a client-only Vite SPA as a systemd unit on a Cloud Server, and Vite's own dev server under alchemy dev. |
| Next.js | `frontend/nextjs.md` | Deploy a Next.js app to Hetzner with Hetzner.Website.Nextjs — next build plus a Node next({ dev: false }) systemd unit, and next dev under alchemy dev. |
| Nuxt | `frontend/nuxt.md` | Deploy a Nuxt app to Hetzner with Hetzner.Website.Nuxt — nitro's node preset as a systemd unit on port 3000, and Nuxt's own dev server under alchemy dev. |
| Octane | `frontend/octane.md` | Deploy an OctaneJS app to Hetzner with Hetzner.Website.Octane — SSR as a systemd unit on port 3000, client assets baked into the unit, and Octane's own Vite dev server under alchemy dev. |
| React Router | `frontend/react-router.md` | Deploy React Router v7 (framework mode) to Hetzner with Hetzner.Website.ReactRouter — SSR as a systemd unit on port 3000, client assets baked into the unit, and React Router's own Vite dev server under alchemy dev. |
| SolidStart | `frontend/solidstart.md` | Deploy a SolidStart app to Hetzner with Hetzner.Website.SolidStart — nitro's node preset as a systemd unit on port 3000, prerendered pages baked into the unit, and SolidStart's own Vite dev server under alchemy dev. |
| Static sites | `frontend/static-site.md` | Deploy a static site to Hetzner with Hetzner.Website.StaticSite — a build command, a systemd unit on a Server, and http://{ipv4}:3000 (or your hostname) on deploy. |
| SvelteKit | `frontend/sveltekit.md` | Deploy a SvelteKit app to Hetzner with Hetzner.Website.SvelteKit — kit SSR as a systemd unit on port 3000, prerendered assets baked into the unit, and Kit's own dev server under alchemy dev. |
| TanStack Start | `frontend/tanstack-start.md` | Deploy TanStack Start (React or Solid) to Hetzner with Hetzner.Website.TanStackStart — SSR as a systemd unit on port 3000, client assets baked into the unit, and TanStack Start's own Vite dev server under alchemy dev. |
| Vinext | `frontend/vinext.md` | Deploy vinext to Hetzner with the shared Website API, native local development, and a platform-specific data cache. |
| Vite | `frontend/vite.md` | Deploy a Vite SPA to Hetzner with Hetzner.Website.Vite — static assets as a systemd unit on a Server, http://{ipv4}:3000, and Vite's own dev server under alchemy dev. |
| Vocs | `frontend/vocs.md` | Deploy a Vocs docs site to Hetzner with Hetzner.Website.Vocs — prerendered HTML on a systemd unit, extensionless routes, and Vocs' own dev server under alchemy dev. |
| Waku | `frontend/waku.md` | Deploy a Waku app to Hetzner with Hetzner.Website.Waku — RSC server as a systemd unit on port 3000, SSG pages baked into the unit, and Waku's own dev server under alchemy dev. |
| Websites | `frontend/websites.md` | Deploy Vite, Astro, Next.js, vinext, Nuxt, React Router, SolidStart, SvelteKit, TanStack Start, Waku, Octane, Foldkit, Vocs, or any static build to Hetzner with first-class Website resources. |

## networking/

| Page | File | Covers |
| --- | --- | --- |
| Networking | `networking/_overview.md` | Private networks, default-deny firewalls, managed load balancers with TLS, and stable Floating & Primary IPs for Hetzner Cloud. |
| DNS | `networking/dns.md` | Hetzner Cloud DNS with Alchemy — Zones and RecordSets as resources, plus ReadDns/WriteDns bindings for querying and mutating records from Effects. |

## tutorial/

| Page | File | Covers |
| --- | --- | --- |
| Part 1: Your First Server | `tutorial/part-1.md` | Install Alchemy, create a Stack with a Hetzner Server, and deploy it. |
| Part 2: Deploy a Service | `tutorial/part-2.md` | Bundle an Effect HTTP server, deploy it to your Hetzner Server as a systemd unit, and serve requests on a public URL. |
| Part 3: Persist Data with a Volume | `tutorial/part-3.md` | Attach a Hetzner Volume, mount it into your Service with the MountVolume binding, and store files that survive deploys. |
| Part 4: Networking & Load Balancing | `tutorial/part-4.md` | Put your Service behind a managed Load Balancer on a private network, and lock the Server down with a Firewall. |
