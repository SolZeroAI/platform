# e2b index

17 pages. Run sandboxes for agents on E2B with Alchemy. Declare templates, warm snapshots, volumes and secrets in TypeScript, and create sandboxes from any Worker or Function.

| Page | File | Covers |
| --- | --- | --- |
| E2B | `_overview.md` | Run sandboxes for agents on E2B with Alchemy. Declare templates, warm snapshots, volumes and secrets in TypeScript, and create sandboxes from any Worker or Function. |
| Team & API keys | `api-keys.md` | How an E2B team holds your templates and sandboxes, how your profile picks the team Alchemy deploys to, and what key each host gets instead of yours. |
| Lifecycle events | `lifecycle-events.md` | Handle sandbox lifecycle events in a Worker as E2B sends them. |
| Network & secrets | `network-and-secrets.md` | Limit where a sandbox can connect, and add credentials to its requests without the sandbox seeing them. |
| Template programs | `programs.md` | Run your own Effect program, or a plain JavaScript program, in every sandbox. |
| Sandboxes | `sandboxes.md` | Create sandboxes from a Worker, run commands, read and write files, and manage their lifecycle. |
| Setup | `setup.md` | Install @alchemy.run/e2b, sign in to E2B with a profile, and deploy from CI. |
| Snapshots & forks | `snapshots.md` | Start sandboxes from a warm base, snapshot a running sandbox, and fork one into copies. |
| Templates | `templates.md` | Build the images your sandboxes boot from, from a registry image, a Dockerfile, or another template. |
| Volumes | `volumes.md` | Keep files that outlive sandboxes, mount them by name, and read or write them without a sandbox. |
| What is E2B? | `what-is-e2b.md` | The concepts behind E2B — teams and API keys, templates, sandboxes, snapshots and forks, volumes, network rules and secrets, and lifecycle events — and how @alchemy.run/e2b models each of them. |

## tutorial/

| Page | File | Covers |
| --- | --- | --- |
| Part 1: Build a Template and a Snapshot | `tutorial/part-1.md` | Declare an E2B template and a snapshot of it with a repository cloned, both built at deploy time, so every sandbox starts ready. |
| Part 2: Start Sandboxes from It | `tutorial/part-2.md` | A Cloudflare Worker that starts a fresh E2B sandbox from the Warm snapshot for each request. |
| Part 3: A Copy per User | `tutorial/part-3.md` | Give each user an E2B sandbox started from the Warm snapshot, which pauses with their changes and resumes when they come back. |
| Part 4: Update the Template | `tutorial/part-4.md` | Change the E2B template, redeploy, and see the snapshot rebuilt on it, while existing sandboxes keep what they started with. |
| Part 5: Testing | `tutorial/part-5.md` | Deploy the Stack in a test, start sandboxes from the Warm snapshot, and check what they contain. |
| Part 6: Stages and CI | `tutorial/part-6.md` | Deploy a stage per environment and per pull request, each with its own E2B template, snapshot and Worker. |
