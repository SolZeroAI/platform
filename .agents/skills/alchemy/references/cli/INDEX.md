# cli index

14 pages. Every alchemy command at a glance — the command map, common options, and how the interactive TUI decides when to render.

| Page | File | Covers |
| --- | --- | --- |
| CLI | `_overview.md` | Every alchemy command at a glance — the command map, common options, and how the interactive TUI decides when to render. |
| Adopting Resources | `adopting-resources.md` | How alchemy takes ownership of pre-existing cloud resources — recovery by default, --adopt for foreign resources, and the programmatic AdoptPolicy. |
| aws | `aws.md` | AWS provider commands — bootstrap the per-account assets bucket that Lambda deployments rely on. |
| cloudflare | `cloudflare.md` | Cloudflare provider commands — bootstrap the state-store worker, mint API tokens, and inspect state-store logs. |
| deploy | `deploy.md` | Compute a plan, ask for approval, and create/update/delete resources to match the desired state. |
| destroy | `destroy.md` | Delete every resource in a stack — plan all existing resources for deletion, ask for approval, and remove them in dependency order. |
| dev | `dev.md` | Run your stack in development mode with hot reloading — resources deploy to the cloud while Workers run in the local dev runtime. |
| drift | `drift.md` | Detect infrastructure drift by re-observing the cloud, and optionally repair it back to the last deployed state. |
| Inspecting State | `inspecting-state.md` | See what alchemy thinks is deployed, debug a bad diff, and recover from bad state. |
| logs | `logs.md` | Fetch or tail logs from deployed resources, merged and color-coded by resource. |
| nuke | `nuke.md` | Enumerate and delete every live resource across the stack's providers. |
| plan | `plan.md` | Preview what would change without applying anything. Equivalent to alchemy deploy --dry-run. |
| profile | `profile.md` | Create, refresh, rename, edit, inspect, or delete Alchemy authentication profiles. |
| state | `state.md` | Browse, read, and delete entries in the state store. |
