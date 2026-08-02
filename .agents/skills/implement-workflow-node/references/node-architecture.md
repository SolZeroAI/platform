# Workflow Node Architecture

Load this reference when implementing, changing, or reviewing Workflow Node behavior in this repository.

## File Map

- `CONTEXT.md`: domain language for **Workflow**, **Workflow Node**, **Workflow Run**, **Workflow Lifecycle**, and **Workflow Artifact**.
- `packages/shared/src/workflow-nodes.ts`: canonical node type list, catalog metadata, ports, default options, type guards, option validation, and template-reference validation.
- `packages/shared/src/workflows.ts`: manifest shape, draft normalization, validation entrypoints, execution ordering.
- `packages/api/src/server/background/workflows/actions.ts`: thin RPC-facing executor. It should delegate node execution through the registry and retain run completion/event RPC methods.
- `packages/api/src/server/background/workflows/nodes/common.ts`: shared node execution Interface and helpers proven across Adapters.
- `packages/api/src/server/background/workflows/nodes/registry.ts`: maps shared `WORKFLOW_NODE_CATALOG` categories to runtime Adapters.
- `packages/api/src/server/background/workflows/nodes/events.ts`: shared node run-event recorder for Adapters.
- `packages/api/src/server/background/workflows/nodes/http.ts`: `http-request` Adapter.
- `packages/api/src/server/background/workflows/nodes/session.ts`: `isolate-session` and `sandbox-session` Adapter.
- `packages/api/src/server/background/workflows/nodes/notification.ts`: `slack-notification` and `email-notification` Adapter.
- `packages/api/src/server/background/workflows/nodes/storage.ts`: R2, KV, and secret storage Adapter.
- `packages/api/src/server/background/workflows/compiler.ts`: generated workflow runtime, inline logic nodes, redaction, and calls into `WorkflowActionExecutor`.
- `tests/workflows/`: focused tests for shared metadata, compiler behavior, Adapters, registry, lifecycle, and executor regressions.

## Category Routing

The runtime Adapter registry derives node routing from shared catalog category metadata:

- `network` -> HTTP Adapter
- `session` -> session Adapter
- `notification` -> notification Adapter
- `storage` -> storage Adapter

`trigger` and `logic` nodes are not action Adapters. Trigger behavior belongs in lifecycle/alarm/webhook code. Logic behavior belongs in `compiler.ts`.

When adding a new action category:

1. Add the category to `WorkflowNodeCategory` in `workflow-nodes.ts`.
2. Add an Adapter Module under `workflows/nodes/`.
3. Register that category in `nodes/registry.ts`.
4. Add registry tests proving the shared category resolves to the Adapter.

## Action Adapter Pattern

Use this shape for action node Modules:

```ts
import type { WorkflowNodeExecutionInput } from "./common"

export type WorkflowExampleNodeExecutionInput = WorkflowNodeExecutionInput

export async function executeWorkflowExampleNode(
  input: WorkflowExampleNodeExecutionInput,
): Promise<Record<string, unknown>> {
  if (input.node.type === "example-node") {
    return runExampleNode(input)
  }
  throw new Error(`Unsupported workflow example node '${input.node.type}'`)
}
```

Keep category-specific helpers private unless another Adapter proves reuse. Prefer category-level tests over testing through `WorkflowActionExecutor`.

## Shared Authoring Checklist

When adding a node type, update:

1. `WORKFLOW_NODE_TYPES`
2. `WORKFLOW_NODE_CATALOG`
3. `getWorkflowNodeDefaultOptions(...)`
4. `validateWorkflowNodeOptions(...)` only when options have real portability or authoring invariants
5. `validateWorkflowNodeTemplateReferences(...)` only when new templated option fields are introduced
6. Tests in `tests/workflows/nodes.test.ts` or `tests/workflows/authoring.test.ts`

Port ids are part of the authored graph contract. Keep names stable and simple.

## Runtime Checklist

For action nodes:

1. Route through the category Adapter, not direct `actions.ts` branching.
2. Use `WorkflowNodeExecutionInput` from `nodes/common.ts`.
3. Use `createNodeContext(...)` and `renderTemplate(...)` for templates.
4. Use `getActionUserId(...)` when user identity is required. `userId` is canonical and required.
5. Use `recordWorkflowNodeRunEvent(...)` for node run events.
6. Keep binding names, provider clients, fetch shapes, and serialization in the Adapter Module.
7. Return `{ outputs: ... }` with keys matching the catalog outputs.
8. Add redaction in `compiler.ts` if outputs or propagated values can contain secrets.

## Test Checklist

Add focused tests before relying on broad executor coverage:

- Direct Adapter tests for success, failure modes, templating, auth/identity, and provider request shape.
- Registry tests when category routing changes.
- Shared node tests for catalog defaults and option validation.
- Compiler tests for logic nodes, ordering, inline behavior, redaction, or generated runtime changes.
- Existing `actions.test.ts` regressions should still pass, but they should not be the only proof for new Adapter behavior.

Always finish with:

```bash
nub run typecheck
nub run lint
nub run format
```
