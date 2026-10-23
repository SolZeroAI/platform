# Offline migration to a new stack

This is not replication or a zero-downtime migration. Rehearse on disposable resources first. The CLI
never freezes traffic, provisions resources, rotates credentials, changes callbacks or switches users.

## Inventory and stop conditions

Record exact source/destination accounts, stages, Workers, databases, buckets, KV and Durable Object
namespace identities. Keep source-read and destination-write credentials separate. Capture health/config
digests, auth capabilities, table counts, webhook IDs, artifact keys and observability destinations.
Preserve application encryption keys: copied encrypted rows/KV require their original keys.

| State | Transfer or cutover action |
| --- | --- |
| D1 control-plane rows | Typed copier to migrated, otherwise empty Postgres; see [database](database.md). |
| Workflow/skill R2 | Copy bytes/metadata; preserve keys, workflow IDs and immutable executable artifacts. |
| Config and user workflow KV | Copy values, metadata, absolute expiration and encrypted envelopes unchanged. |
| Repository/response caches | Explicitly choose copy or rebuild; do not classify them as user state. |
| SessionDO / IsolateSessionAgent | Explicit logical names and strict schema-compatible SQL/KV transfer below. |
| Sub-agents / containers | Drain; inventory separately. Session export does not copy child namespaces or container filesystems. |
| Running Workflows / alarms / sockets | Drain or cancel explicitly. Never recreate running executions, alarms or connections from copied state. |
| Schedules / AI Search / Vectorize / registries | Recreate external resources and refresh references before enabling schedules; not inferred from bucket copy. |
| Domains / callbacks / webhooks / telemetry | Provision destination equivalents, update callers and verify delivery; do not reuse cross-account IDs blindly. |

Current session classes expose an internal, undecorated migration RPC, not an application route or
client-callable chat method. An old release needs a reviewed compatible exporter backport. Compare
actual inventories first. Different table sets, columns or rowid modes fail closed: provide an explicit
tested compatibility mapping before import. Do not upgrade an old object's SDK merely to make layouts
match. This tooling does not establish compatibility for every historical SolZero release.

## Relational rehearsal and final copy

Provision destination migrations, but do not sign in or create application data there before import.
Only the untouched built-in seed is eligible for automatic reconciliation. Use an operator SQL credential
with transaction permissions. Store trusted operator dumps outside the checkout, directories mode 0700
and files mode 0600. Run the default dry-run, then a rehearsed `--apply --source-writes-frozen`, then
`--verify-only` as [documented](database.md). Source reads use a SQLite snapshot. Capture the final dump
after ingress is frozen and work is drained. Never cut over on a failed count/checksum comparison.

## Portable storage operator

The standalone temporary Worker in `scripts/migration/worker.ts` binds one existing resource. Copy
`wrangler.example.jsonc` to ignored `*.local.jsonc`, select `kv`, `r2`, `session` or `isolate`, remove unused
bindings and fill exact resource IDs. `MIGRATION_RESOURCE_ID` must be a validated unique account/resource
identity, not a stage label. For objects, bind the existing script/class; do not create a replacement
namespace to export the source. The example is not deployable unchanged. Generate binding types with
`nub run migration:types`.

Use separate operators. Set source `MIGRATION_WRITABLE=false`; destination `true` and offline. Securely
set a different random `MIGRATION_TOKEN` (at least 32 characters) on each Worker. Restrict access at the
network/account boundary as well. Deploy only after approval of the resource plans. No token values in
JSONC or CLI arguments. Supply `MIGRATION_SOURCE_TOKEN` / `MIGRATION_DESTINATION_TOKEN` through a
secure process environment. Root HTTPS URLs only; HTTP is permitted only for local loopback fixtures.
Redirects are rejected. Reports contain counts/digests, not payloads or raw driver errors.

```sh
# Freeze ingress, drain work and disconnect clients first.
nub run migration:storage -- export --kind r2 --url https://source-operator.example.test \
  --directory /private/migration/source-r2 --writes-frozen

# Plan only: verify all bundle hashes and page order before any writes.
nub run migration:storage -- import --url https://destination-operator.example.test \
  --directory /private/migration/source-r2

# Apply to the distinct offline destination, then independently re-export it.
nub run migration:storage -- import --url https://destination-operator.example.test \
  --directory /private/migration/source-r2 --apply --writes-frozen \
  --verification-directory /private/migration/destination-r2-proof
```

Repeat per namespace/bucket. Session/isolate exports additionally require
`--object-names /private/migration/names.json`: a complete array of logical names from the control-plane
inventory. The Worker cannot enumerate a DO namespace. Hashed physical IDs are not logical routing
names. Preserve session IDs and routing conventions.

Bundles contain streamed content-addressed blobs and a checksummed manifest. Existing differing KV/R2
values cannot be overwritten; identical values can resume and are independently verified. DO imports
require empty, quiescent targets without WebSockets. Progress commits with state and permits the same
transfer to resume; no source DDL is accepted. SQL rowids/BLOBs, structured DO KV, KV expiration and
R2 HTTP/custom metadata are preserved. Unsupported structured-value graphs fail closed. Pages are
bounded to 100 rows/8 MiB; oversized values need an explicit strategy. Alarms are deliberately removed
and object instances reloaded.

Freeze is an operator acknowledgement, not enforcement. Re-export the source after import and compare
its body digest with the original. KV is eventually consistent: allow propagation and require repeated
stable exports before accepting the final inventory. Expiring keys near TTL need explicit reconciliation.

## Cutover gate

Compare Alchemy plans with approved inventories. Never delete/replace source resources. Independently
verify relational counts/keys/checksums and every required store digest. Test old artifact loading without
recompilation, ordinary auth, linking, provider defaults, agent history, MCP discovery and observability.
Coordinate webhook smoke tests with callers. GitHub App rotation and callback changes are separate
coordinated actions; do not rotate application encryption keys with App credentials.

Only then enable destination ingress/schedules and update external webhook URLs. Keep the source
read-only through rollback. After new writes, rollback requires reconciliation, not just an old Worker
or domain. Delete temporary operator Workers and revoke tokens after verification/rollback needs end.
Retain private bundles under organizational policy; do not delete them automatically on failure.
