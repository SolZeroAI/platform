# boat index

19 pages. Run sandboxes on Boat with Alchemy. Declare sandboxes, snapshots, environments and webhooks in TypeScript, and create sandboxes from any Worker or Function.

| Page | File | Covers |
| --- | --- | --- |
| Boat | `_overview.md` | Run sandboxes on Boat with Alchemy. Declare sandboxes, snapshots, environments and webhooks in TypeScript, and create sandboxes from any Worker or Function. |
| Account & API keys | `account-and-keys.md` | How a Boat account holds your sandboxes, how an API key limits what a caller can do, and the key each host gets instead of yours. |
| Setup | `setup.md` | Install @alchemy.run/boat, sign in to Boat with a profile, and deploy from CI. |
| What is Boat? | `what-is-boat.md` | The concepts behind Boat — accounts and API keys, sandboxes and their lifecycle, snapshots and forks, environments, credential profiles and the AI credentials proxy, ports and webhooks — and how @alchemy.run/boat models each of them. |

## sandboxes/

| Page | File | Covers |
| --- | --- | --- |
| Choosing a runtime | `sandboxes/choosing-a-runtime.md` | Program sandboxes, a declared dev box, and sandboxes created per task, and when to use each. |
| Lifecycle events | `sandboxes/lifecycle-events.md` | Receive Boat's sandbox lifecycle events — ready, stopped, failed, restored — in a Cloudflare Worker, checked against Boat's signature and filtered to your stack's sandboxes. |
| Ports & URLs | `sandboxes/ports.md` | Serve a port of a Boat sandbox at an HTTPS URL, protected by a token or public, and call it or proxy to it from a Worker. |
| Programs | `sandboxes/programs.md` | Run an Effect HTTP program in its own Boat sandbox, served at a URL, restarted in place when its code changes. |
| Sandboxes | `sandboxes/sandboxes.md` | Boat sandboxes — machine sizes, auto-stop, stop and resume, labels — declared as a long-lived dev box or created per task from a Worker or Function. |
| Snapshots & forks | `sandboxes/snapshots.md` | Save a Boat sandbox's disk as a named snapshot, start sandboxes from it, and fork a sandbox into copies. |

## security/

| Page | File | Covers |
| --- | --- | --- |
| Credential profiles | `security/credential-profiles.md` | Boat credential profiles — the AI keys and API secrets a sandbox gets, and the proxy that keeps the real ones out of it. |
| Credentials & bindings | `security/credentials.md` | What each host gets to reach Boat, deploy-time resources vs clients your app runs, and who owns the sandboxes your app creates. |
| Environments & secrets | `security/environments.md` | Boat environments — the variables, secret files and credentials a sandbox starts with, versioned on every change. |

## tutorial/

| Page | File | Covers |
| --- | --- | --- |
| Part 1: Build a Snapshot | `tutorial/part-1.md` | Declare a Boat snapshot that clones a repository and installs tools at deploy time, so every sandbox starts ready. |
| Part 2: Start Sandboxes from It | `tutorial/part-2.md` | A Cloudflare Worker that starts a fresh Boat sandbox from the Golden snapshot for each request. |
| Part 3: A Copy per User | `tutorial/part-3.md` | Give each user a Boat sandbox started from the Golden snapshot, which keeps their changes and resumes when they come back. |
| Part 4: Update the Snapshot | `tutorial/part-4.md` | Change the Golden snapshot, redeploy, and see new sandboxes start from the new disk while existing ones keep theirs. |
| Part 5: Testing | `tutorial/part-5.md` | Deploy the Stack in a test, start sandboxes from the Golden snapshot, and check what they contain. |
| Part 6: Stages and CI | `tutorial/part-6.md` | Deploy a stage per environment and per pull request, each with its own Boat snapshot and Worker. |
