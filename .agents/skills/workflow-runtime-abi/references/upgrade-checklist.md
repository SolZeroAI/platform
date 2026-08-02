# Workflow Runtime ABI Upgrade Checklist

## Repository Map

- `packages/shared/src/workflows.ts`: current `WORKFLOW_MANIFEST_VERSION`, manifest types, draft normalization, validation, export shape.
- `packages/shared/src/workflow-nodes.ts`: node definitions, ports, handles, runtime support, option validation, template validation.
- `packages/api/src/server/background/workflows/runtime-abi.ts`: ABI registry, current runtime ABI, kernel module map, loader fingerprint.
- `packages/api/src/server/background/workflows/runtime-kernel.ts`: TypeScript kernel implementation plus immutable JS source strings loaded by dynamic workflow artifacts.
- `packages/api/src/server/background/workflows/manifest-migrations.ts`: save-time manifest migrations and dry-run compatibility audit.
- `packages/api/src/server/background/workflows/compiler.ts`: generated workflow code and selected runtime kernel module import.
- `packages/api/src/server/background/workflows/runner.ts`: dynamic workflow loader, code artifact lookup by workflow version, cache key, and run resume behavior.
- `packages/api/src/server/background/workflows/lifecycle.ts`: create/update save path that migrates, compiles, writes versioned artifacts, and updates workflow rows.
- `scripts/workflows/audit-runtime-abi.ts`: CLI audit/backfill entrypoint.
- `apps/web/src/routes/workflows.tsx`: workflow save UI, migration summary, runtime version change display, import/export flows.
- `tests/workflows/runtime-abi.test.ts`: ABI registry, manifest migration, and audit tests.
- `tests/workflows/runtime-kernel.test.ts`: runtime kernel behavior tests.
- `tests/workflows/runner.test.ts`: artifact version lookup, dynamic metadata, loader cache key, resume helpers.
- `tests/workflows/lifecycle.test.ts`: save/update behavior and versioned artifacts.

## New Version Steps

1. Define the next manifest version in `packages/shared/src/workflows.ts`.
2. Add any needed legacy manifest type locally near the migrator or test fixture instead of weakening the current manifest type globally.
3. Add a `fromVersion -> toVersion` migrator in `manifest-migrations.ts`.
4. Keep existing migrators in place so older manifests upgrade through each intermediate version.
5. Update audit findings for the exact changed runtime contract:
   - old `nodes.*` or `trigger.*` template paths
   - renamed source or target handles
   - renamed node types
   - changed trigger payload fields
   - changed action output or redaction shapes
6. Add a new kernel module name and source string in `runtime-kernel.ts` when compiled runtime behavior changes.
7. Register the new kernel in `runtime-abi.ts`, append the ABI version to `WORKFLOW_RUNTIME_ABI_VERSIONS`, and advance `CURRENT_WORKFLOW_RUNTIME_ABI_VERSION`.
8. Ensure `compiler.ts` imports the current kernel by asking `getWorkflowRuntimeKernelModuleName(CURRENT_WORKFLOW_RUNTIME_ABI_VERSION)`.
9. Ensure `runner.ts` still loads all kernel modules from `getWorkflowRuntimeKernelModules()` and keys the loader cache with `getWorkflowRuntimeLoaderCacheVersion()`.
10. Confirm run control paths pass `run.workflow_version` into `getWrappedWorkflowBinding`.
11. Extend `scripts/workflows/audit-runtime-abi.ts` only if the CLI input/output needs new fields or write behavior.
12. Update UI save/import/export migration summaries only when users need to understand the upgrade.

## Focused Test Patterns

Use small manifests that isolate the changed contract. Avoid fixture churn unrelated to the ABI delta.

For a handle rename:

- fixture with old handle on a previous-version manifest
- expectation that migration rewrites the handle
- audit finding when the handle cannot be safely mapped
- validation that a current manifest using the new handle is unchanged

For a template context change:

- fixture with the old `{{nodes.id.output}}` or `{{trigger.field}}` expression
- expectation that migration rewrites deterministic cases
- warning or error for ambiguous expressions
- one runtime behavior assertion for the new template scope

For a kernel behavior change:

- old compiled artifact or direct old kernel fixture preserves old behavior
- new compiled artifact imports the new module name
- loader exposes both module names
- cache version changes when the new kernel source changes

For run resume:

- existing run with `workflow_version` older than current workflow row
- approval, reconcile, or delete path calls `getWrappedWorkflowBinding(workflow, run.workflow_version)`
- previous artifact key is deterministic and does not use the latest row `code_key`

## Commands

```bash
nub exec vitest run tests/workflows/runtime-abi.test.ts
nub exec vitest run tests/workflows/runtime-kernel.test.ts
nub exec vitest run tests/workflows/runner.test.ts tests/workflows/lifecycle.test.ts
nub run workflow:runtime:audit path/to/workflow-export.json
nub run workflow:runtime:audit --write path/to/workflow-export.json
```

Use `--write` only for local fixtures or when the user explicitly requests mutation.
