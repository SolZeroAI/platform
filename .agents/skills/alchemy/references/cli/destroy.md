<!-- source: https://alchemy.run/cli/destroy
     upstream: website/src/content/docs/cli/destroy.mdx
     alchemy 2.0.0-beta.79 @ e354a45 -->

# destroy

> Delete every resource in a stack — plan all existing resources for deletion, ask for approval, and remove them in dependency order.

```sh
alchemy destroy [options]
```

`destroy` deletes every resource in a stack. It computes a plan where all existing resources are marked for deletion, asks for approval, and removes them in dependency order.

Under the hood, `destroy` is `deploy` with the desired state zeroed out — every resource in state plans as a deletion.

```text
Plan: 2 to delete

- Worker (Cloudflare.Worker)
- Bucket (Cloudflare.R2.Bucket)

Proceed?
◉ Yes ○ No
✗ Worker (Cloudflare.Worker) deleted
✗ Bucket (Cloudflare.R2.Bucket) deleted
```

## Flags

| Option              | Description                                                       |
| ------------------- | ----------------------------------------------------------------- |
| `--config, -c <file>`            | Stack file to destroy (defaults to `alchemy.run.ts`)              |
| `--stage <name>`    | Stage to destroy (defaults to `$ALCHEMY_STAGE` or `live_$USER`)   |
| `--yes`             | Skip the approval prompt                                          |
| `--dry-run`         | Show what would be deleted without actually deleting              |
| `--profile <name>`  | Auth profile to use (defaults to `$ALCHEMY_PROFILE` or `default`) |
| `--env-file <path>` | Load environment variables from a file                            |

## Examples

```sh
# Destroy a PR preview environment
alchemy destroy --stage pr-42 --yes

# Destroy your personal cloud sandbox
alchemy destroy --stage live_sam

# Destroy the local-dev stage created by alchemy dev
alchemy destroy --stage dev_sam
```

## Retained resources

Resources declared with `RemovalPolicy.retain()` are skipped by
`destroy`: the provider's `delete` is never called and only the state
row is dropped, so the cloud object outlives the stack. The same is
true of a resource whose declaration you simply delete — the orphan
sweep reads the policy from the state row, not from your code.

```typescript
import * as RemovalPolicy from "alchemy/RemovalPolicy";

const data = yield* R2.Bucket("Data").pipe(RemovalPolicy.retain());
```

See [Resource lifecycle › Removal policy](/infrastructure-as-code/resource-lifecycle#removal-policy).

`destroy` is scoped to one stack + stage and driven by the state store; to enumerate and delete everything a set of providers can see in the live account, see [nuke](/cli/nuke).

## Where next

- [deploy](/cli/deploy) — bring the stack back
- [nuke](/cli/nuke) — account-wide teardown, not scoped to a stack
- [state](/cli/state) — inspect and clear the state the plan is driven by
- [Stages](/environments/stages) — how environments are isolated
- [Resource lifecycle › Removal policy](/infrastructure-as-code/resource-lifecycle#removal-policy) — keep a resource when its stack goes away
