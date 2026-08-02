---
name: implement-workflow-node
description: Use when adding, changing, or reviewing Workflow Nodes in the c0 agent repo, including shared node catalog metadata, Workflow Node options and ports, runtime node Adapters, adapter registry routing, compiler inline logic nodes, workflow validation, and tests for Workflow Node execution.
---

# Implement Workflow Node

Use this skill when implementing or reviewing a new **Workflow Node** in this repo. Keep authored metadata, runtime execution, validation, and tests aligned.

## Start Here

1. Read `CONTEXT.md` for domain terms, especially **Workflow**, **Workflow Node**, and **Workflow Run**.
2. Read `references/node-architecture.md` for the current file map and Adapter pattern.
3. Inspect the closest existing node category before editing:
   - Runtime action Adapter: `packages/api/src/server/background/workflows/nodes/*.ts`
   - Shared catalog/options: `packages/shared/src/workflow-nodes.ts`
   - Inline logic execution: `packages/api/src/server/background/workflows/compiler.ts`
   - Tests: `tests/workflows/*`

## Choose The Node Kind

- **Trigger nodes** start Workflow Runs. Add scheduling/webhook lifecycle behavior only when the node actually starts runs.
- **Logic nodes** execute inside compiled workflow code. Implement them in `compiler.ts`; do not route them through `WorkflowActionExecutor`.
- **Action nodes** execute through `WorkflowActionExecutor` and the node Adapter registry. Add runtime behavior behind the appropriate Adapter Module.
- **Provider variants** should live inside an existing category Adapter unless behavior divergence justifies a new concrete Adapter Seam.

## Implementation Workflow

1. Add the node type to `WORKFLOW_NODE_TYPES` and `WORKFLOW_NODE_CATALOG` in `packages/shared/src/workflow-nodes.ts`.
2. Add default options in `getWorkflowNodeDefaultOptions(...)`.
3. Add option/template validation only for real invariants. Keep validation in shared code when it affects authoring or portability.
4. If it is an action node, add execution to a category Adapter under `packages/api/src/server/background/workflows/nodes/`.
5. If it needs a new action category, add the category to shared metadata and register a category Adapter in `nodes/registry.ts`.
6. Keep `actions.ts` as a thin `WorkflowActionExecutor`; it should delegate through `executeWorkflowNodeWithAdapters(...)`.
7. Add focused direct Adapter tests and keep executor regression tests only for end-to-end dispatch behavior.

## Runtime Rules

- Require `userId`; do not reintroduce `userNamespace` terminology.
- Use `createNodeContext(...)` and `renderTemplate(...)` from `nodes/common.ts` for runtime templating.
- Use `recordWorkflowNodeRunEvent(...)` from `nodes/events.ts` for node action run events.
- Keep `nodes/common.ts` small. Move helpers there only after at least two Adapters need the same Interface.
- Keep provider calls and binding knowledge inside Adapter Modules, not in `actions.ts` or shared authoring code.
- Redact secret values in compiler/run-event paths if the node can expose secrets or derived secret values.

## Tests And Validation

Add or update focused tests based on the node kind:

- Shared catalog/defaults/validation: `tests/workflows/nodes.test.ts` and `tests/workflows/authoring.test.ts`
- Runtime Adapter: a direct `tests/workflows/<category-or-node>-nodes.test.ts`
- Registry routing: `tests/workflows/node-registry.test.ts`
- Compiler/logic behavior: `tests/workflows/compiler.test.ts`
- Executor regression, only when dispatch behavior changes: `tests/workflows/actions.test.ts`

Run the narrowest relevant Vitest command while iterating, then run the repo-root checks required by `AGENTS.md` before handoff:

```bash
nub run typecheck
nub run lint
nub run format
```
