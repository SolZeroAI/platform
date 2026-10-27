<!-- source: https://alchemy.run/cli/plan
     upstream: website/src/content/docs/cli/plan.mdx
     alchemy 2.0.0-beta.79 @ e354a45 -->

# plan

> Preview what would change without applying anything. Equivalent to alchemy deploy --dry-run.

```sh
alchemy plan [options]
```

`plan` previews what would change without applying anything — it is equivalent to `alchemy deploy --dry-run`.

```text
Plan: 1 to create, 1 to update

+ Queue (AWS.SQS.Queue)
~ Worker (Cloudflare.Worker)
```

The plan uses `+` for creates, `~` for updates, `-` for deletes,
and `•` for no-ops. No approval prompt is shown and no changes are
made.

## Detailed property changes

Pass `--detailed` to show declared resource inputs as YAML:

```sh
alchemy plan --detailed
```

```text
Plan: 1 to create, 1 to update

+ EventsQueue
  properties:
    fifo: true
    visibilityTimeout: 30

~ OrderHandler
  before:
    memorySize: 512
    env:
      MODE: development
  after:
    memorySize: 1024
    env:
      MODE: production
```

Creates show their desired properties. Updates and replacements show the
previously persisted declared properties followed by the desired properties;
this is a declaration diff, not a live-cloud drift read. Outputs appear as
`(known after apply)`, computed values as `(computed)`, and secrets remain
redacted. Deletes stay compact.

## Flags

| Option              | Description                                                       |
| ------------------- | ----------------------------------------------------------------- |
| `--config, -c <file>`            | Stack file to plan (defaults to `alchemy.run.ts`)                 |
| `--stage <name>`    | Stage to plan against (defaults to `$ALCHEMY_STAGE` or `live_$USER`) |
| `--profile <name>`  | Auth profile to use (defaults to `$ALCHEMY_PROFILE` or `default`) |
| `--env-file <path>` | Load environment variables from a file                            |
| `--adopt`           | Plan adoption of pre-existing cloud resources that conflict with this stack instead of failing (see [Adopting Resources](/cli/adopting-resources)) |
| `--detailed`        | Show declared resource properties as YAML                        |

## Where next

- [deploy](/cli/deploy) — apply the plan
- [destroy](/cli/destroy) — delete everything in a stack
- [Inspecting State](/cli/inspecting-state) — examine what the plan diffs against
