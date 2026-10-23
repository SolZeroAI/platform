---
packages:
  "release:solzero": minor
---

## Verify an offline migration before cutover

The D1-to-Postgres copier now uses bounded batches, rejects unmapped data, preserves legacy built-in
skill identities, and independently verifies row counts and checksums. Apply requires an explicit
write-freeze acknowledgement. Reports omit secret values.

Operators can export and verify R2, KV and schema-compatible session state through a separate temporary
authenticated Worker. Rehearse first: running work, alarms, external resources and incompatible historical
schemas require explicit cutover handling. Keep both stacks offline during the final transfer and follow
the migration runbook before enabling the destination.
