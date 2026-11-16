# daytona index

20 pages. Run code you don't fully trust in Daytona sandboxes. Declare snapshots, volumes and secrets in your Stack, and create, drive and delete sandboxes from any Worker or Lambda.

| Page | File | Covers |
| --- | --- | --- |
| Daytona | `_overview.md` | Run code you don't fully trust in Daytona sandboxes. Declare snapshots, volumes and secrets in your Stack, and create, drive and delete sandboxes from any Worker or Lambda. |
| Organizations and API keys | `organizations-and-keys.md` | How a Daytona organization holds your sandboxes and bill, how your profile picks the organization Alchemy deploys to, and the API key each Worker gets. |
| Setup | `setup.md` | Sign Alchemy in to Daytona, or give it an API key. |
| What is Daytona? | `what-is-daytona.md` | The concepts behind Daytona — organizations, API keys, regions and runners, snapshots, sandboxes and their lifecycle, the toolbox, previews, volumes, network limits and secrets — and how @alchemy.run/daytona models each of them. |

## networking/

| Page | File | Covers |
| --- | --- | --- |
| Network and previews | `networking/network.md` | What a Daytona sandbox can reach — your organization's tier, domain and CIDR allowlists, no network at all — and how preview URLs let the outside reach a port inside it. |

## observability/

| Page | File | Covers |
| --- | --- | --- |
| Telemetry, webhooks and audit | `observability/telemetry.md` | Send a Daytona organization's sandbox logs, traces and metrics to your backend, get webhooks for sandbox events, and read usage and the audit log from a Worker. |

## organization/

| Page | File | Covers |
| --- | --- | --- |
| Members and roles | `organization/organization.md` | Give people access to a Daytona organization with roles, invitations and members, sign them in with single sign-on, and set organization defaults. |

## sandboxes/

| Page | File | Covers |
| --- | --- | --- |
| Programs in a sandbox | `sandboxes/programs.md` | Run an Effect program you write inside a Daytona sandbox, redeploy it without losing the sandbox, mount volumes into it, and install mount clients with a derived snapshot. |
| Regions and runners | `sandboxes/runners.md` | Where Daytona sandboxes run — shared regions, the region a sandbox picks, and a region of your own with runners on machines you operate. |
| Sandboxes | `sandboxes/sandboxes.md` | How a Daytona sandbox moves between started, stopped, archived and deleted, and how to create sandboxes per request or per user from a Worker, or declare a long-lived dev box in your Stack. |
| Snapshots | `sandboxes/snapshots.md` | Pull an image, build a Dockerfile on Daytona, or capture a warm base that sandboxes start from. |
| Toolbox | `sandboxes/toolbox.md` | Run commands, edit files, use git and language servers, open previews and SSH into a sandbox. |
| Volumes | `sandboxes/volumes.md` | Keep files in volumes that outlive sandboxes, shared or one per user. |

## security/

| Page | File | Covers |
| --- | --- | --- |
| Secrets | `security/secrets.md` | Give a Daytona sandbox credentials it can use but not read, shared or one per user, with values from .env or a secrets manager. |

## tutorial/

| Page | File | Covers |
| --- | --- | --- |
| Part 1: Build a Warm Snapshot | `tutorial/part-1.md` | Declare a Daytona snapshot of an image, and a warm snapshot of it with a repository cloned, both built at deploy time. |
| Part 2: Start Sandboxes from It | `tutorial/part-2.md` | A Cloudflare Worker that starts a fresh Daytona sandbox from the warm snapshot for each request. |
| Part 3: A Copy per User | `tutorial/part-3.md` | Give each user a Daytona sandbox started from the warm snapshot, which stops when idle and starts again with their changes. |
| Part 4: Update the Snapshot | `tutorial/part-4.md` | Move the Daytona snapshots to a new Node.js version, redeploy, and see new sandboxes start from it while existing ones keep theirs. |
| Part 5: Testing | `tutorial/part-5.md` | Deploy the Stack in a test, start sandboxes from the warm snapshot, and check what they contain. |
| Part 6: Stages and CI | `tutorial/part-6.md` | Deploy a stage per environment and per pull request, each with its own Daytona snapshots and Worker. |
