<!-- source: https://alchemy.run/cli/deploy
     upstream: website/src/content/docs/cli/deploy.mdx
     alchemy 2.0.0-beta.79 @ e354a45 -->

# deploy

> Compute a plan, ask for approval, and create/update/delete resources to match the desired state.

```sh
alchemy deploy [options]
```

`deploy` computes a plan, asks for approval, and creates/updates/deletes resources to match the desired state.

```text
Plan: 2 to create

+ Bucket (Cloudflare.R2.Bucket)
+ Worker (Cloudflare.Worker) (1 bindings)
  + Bucket

Proceed?
◉ Yes ○ No
✓ Bucket (Cloudflare.R2.Bucket) created
✓ Worker (Cloudflare.Worker) created
  • Uploading worker (14.20 KB) ...
  • Enabling workers.dev subdomain...
{
  url: "https://myapp-worker-dev-you-abc123.workers.dev",
}
```

On subsequent deploys, only changed resources are updated:

```text
Plan: 1 to update

~ Worker (Cloudflare.Worker)

Proceed?
◉ Yes ○ No
✓ Worker (Cloudflare.Worker) updated
  • Uploading worker (15.10 KB) ...
{
  url: "https://myapp-worker-dev-you-abc123.workers.dev",
}
```

When the plan contains no changes, the approval prompt is skipped automatically.

## Flags

| Option              | Description                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `--config, -c <file>`            | Stack file to deploy (defaults to `alchemy.run.ts`)                                                                        |
| `--stage <name>`    | Stage to deploy to (defaults to `$ALCHEMY_STAGE` or `live_$USER`)                                                          |
| `--yes`             | Skip the approval prompt                                                                                                   |
| `--dry-run`         | Show the plan without applying (same as `alchemy plan`)                                                                    |
| `--detailed`        | Show declared resource properties as YAML                                                                                  |
| `--force`           | Force updates for resources that would otherwise no-op                                                                     |
| `--adopt`           | Adopt pre-existing cloud resources that conflict with this stack instead of failing. Useful for re-importing into a fresh state store. |
| `--profile <name>`  | Auth profile to use (defaults to `$ALCHEMY_PROFILE` or `default`)                                                  |
| `--env-file <path>` | Load environment variables from a file                                                                                     |

How `--adopt` decides what to take over is covered in [Adopting Resources](/cli/adopting-resources).

`--dry-run` runs the exact same code path as [`alchemy plan`](/cli/plan) — see that page for the plan output format.

`--detailed` adds the YAML property view to the approval prompt, `--yes`
deploys, and `--dry-run` previews.

## Examples

```sh
# Deploy to production, skip the prompt
alchemy deploy --stage prod --yes

# Deploy a PR preview environment
alchemy deploy --stage pr-42

# Deploy a different stack file
alchemy deploy --config stacks/github.ts

# Preview what would change
alchemy deploy --dry-run

# Review declared inputs as YAML before applying
alchemy deploy --detailed

# Re-import existing cloud resources into a fresh state store
alchemy deploy --adopt
```

## Where next

- [plan](/cli/plan) — preview changes without applying
- [destroy](/cli/destroy) — delete everything in a stack
- [Adopting Resources](/cli/adopting-resources) — take over pre-existing infrastructure
- [Resource Lifecycle](/infrastructure-as-code/resource-lifecycle) — what happens inside a deploy
