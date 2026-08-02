---
name: workflow-runtime-abi
description: Guidance for safely changing the c0 Workflow runtime ABI, manifest ABI, runtime kernels, manifest migrations, workflow artifact compatibility, and audit/backfill tooling. Use when modifying workflow runtime contracts, compiled workflow imports, kernel modules, manifest versions, node handle semantics, template context such as nodes.* or trigger.*, workflow artifact loading, in-flight workflow run resume behavior, or any workflow node catalog/default/validation/adapter change where persisted node options, ports, outputs, trigger payloads, or old workflow artifacts could execute differently.
---

# Workflow Runtime ABI

## Core Model

Treat the Workflow runtime ABI as a versioned contract between saved workflow artifacts, generated workflow code, manifest shape, node handles, template context, and runtime kernel behavior.

Preserve old contracts. Add new contracts. Migrate editable manifests explicitly on save or audit. Let in-flight runs continue on the `workflow_runs.workflow_version` and compiled artifact they started with.

For repository-specific file maps and checklists, read [references/upgrade-checklist.md](references/upgrade-checklist.md) before editing.

## Early Trigger Check

Use this skill alongside node-implementation guidance when changing workflow node catalog entries, defaults, option validation, inspector options, ports, outputs, or adapter behavior. Treat the change as ABI-relevant until proven otherwise if any of these are true:

- the value is stored under `WorkflowManifestNode.options`
- an existing manifest could already contain the field, handle, node type, or output name as inert or user-authored data
- the runtime starts interpreting a previously ignored option or changes how an existing option is interpreted
- compiled workflow code, action adapter inputs, run event redaction, or saved artifact loading needs an additional field
- a workflow saved before the change would produce different action outputs, side effects, events, or stored artifacts after the change

## Version Decision

Create a new runtime or manifest ABI version when a change affects any saved or compiled workflow artifact behavior:

- generated workflow code imports or calls a runtime kernel differently
- runtime kernel inputs, outputs, trigger payloads, redaction, action result normalization, branch gating, or CEL scope changes
- manifest `version`, node option shape, default option meaning, edge handle names, node type names, port/output names, template expressions, or validation semantics change
- adapter behavior begins honoring a persisted option, rejects a value that used to be accepted, or changes the side effect for an existing option value
- old `nodes.*` or `trigger.*` templates need translation, warning, or rejection
- old artifacts would execute differently if loaded with the new implementation

Do not create a new ABI version for internal refactors that preserve the behavior of every existing artifact and manifest contract.

## Implementation Flow

1. Read the current ABI files and tests before editing.
2. Identify the precise contract delta: source version, target version, migrated fields, runtime behavior, and incompatible old references.
3. Add the next version beside the old one. Keep previous kernel source and manifest migrations immutable except for tests or comments that do not change behavior.
4. Chain migrations one version at a time. Prefer `v1 -> v2 -> v3` over a direct `v1 -> v3` jump so each upgrade is auditable.
5. Compile only new saves against the current ABI. Keep the loader able to serve every supported kernel module needed by old compiled artifacts.
6. Keep run resume paths bound to `workflow_runs.workflow_version`; never silently switch a live run to the latest workflow version.
7. Extend the dry-run audit/backfill path for the exact changed handles, templates, node types, or runtime contracts. Default to audit-only; require an explicit write flag for mutation.
8. Surface migration summaries through save/update responses and UI only when the change is user-visible.

## Multiple Kernels

Support multiple kernels by registering each immutable kernel module and advancing `CURRENT_WORKFLOW_RUNTIME_ABI_VERSION` only for newly compiled workflow code.

The upgrade path between kernels is a manifest migration plus compiler/runtime registry change:

- old compiled artifact imports `workflow-runtime-kernel.vN.js`
- new compiled artifact imports `workflow-runtime-kernel.vN+1.js`
- dynamic loader includes both modules
- manifest migration rewrites old editable manifests into the new current manifest contract
- in-flight runs continue resolving their original workflow artifact version

Do not make the current kernel emulate every old contract unless the old compiled artifacts actually import that kernel.

## Migration Rules

Implement migrations as small, deterministic transforms. Each migration should:

- accept exactly one source version and produce exactly the next version
- document what changed in the step description
- preserve user-authored data when possible
- report ambiguous or unsafe changes through audit findings instead of guessing
- normalize and validate the migrated manifest before saving
- reject unsupported future versions

When renaming handles, node types, options, or template paths, update both the save migration and the audit scanner. The audit should identify the path and node where manual review is needed.

## Test Requirements

Write focused tests around the changed contract, not broad snapshots.

At minimum, add or update tests that prove:

- the registry exposes all supported kernels and selects the new current ABI
- old kernel module names remain available for old compiled artifacts
- a previous-version manifest migrates to the new manifest with only the intended deltas
- current manifests remain unchanged when saved
- unsupported future manifest versions fail clearly
- audit catches old templates, renamed handles, or runtime contract references affected by the change
- old workflow runs and approval/reconcile paths use `run.workflow_version` instead of latest workflow version

If runtime behavior changes, add paired kernel tests: one fixture for old behavior on the old kernel and one fixture for new behavior on the new kernel.

## Validation

Run the smallest relevant set first, then broaden if shared behavior changed:

```bash
nub exec vitest run tests/workflows/runtime-abi.test.ts tests/workflows/runtime-kernel.test.ts tests/workflows/runner.test.ts tests/workflows/lifecycle.test.ts
nub run workflow:runtime:audit <fixture-or-export.json>
nub run lint
```

If the change touches HTTP workflow APIs, UI save flows, or dynamic workflow loading, also run the matching integration or route tests.

## Review Checklist

Before finishing, verify:

- old workflow artifacts and kernel source strings are not rewritten in place
- `WORKFLOW_RUNTIME_ABI_VERSIONS` includes every supported kernel
- loader cache keys include all runtime kernel source fingerprints
- save/update paths migrate manifests explicitly before writing new artifacts
- artifact keys stay versioned and immutable
- dry-run audit output is actionable and safe by default
- tests describe the changed ABI contract in fixture names and assertions
