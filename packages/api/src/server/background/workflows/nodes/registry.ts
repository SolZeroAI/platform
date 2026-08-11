import {
  getWorkflowNodeRuntimeSupport,
  isWorkflowNodeType,
  type WorkflowNodeAdapterCategory,
} from "@solzero/shared"
import type { WorkflowNodeExecutionInput } from "./common"
import { executeWorkflowHttpNode } from "./http"
import { executeWorkflowNotificationNode } from "./notification"
import { executeWorkflowSessionNode } from "./session"
import { executeWorkflowSlackNode } from "./slack"
import { executeWorkflowStorageNode } from "./storage"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"

export interface WorkflowNodeAdapter {
  category: WorkflowNodeAdapterCategory
  execute(input: WorkflowNodeExecutionInput): Promise<Record<string, unknown>>
}

const runNode =
  (
    // oxlint-disable-next-line s0-lint/no-manual-effect-channels -- Promise-boundary bridge: the channel must be named so the Effect node executors can be run at the Promise-typed WorkflowActionExecutor RPC ABI edge.
    execute: (input: WorkflowNodeExecutionInput) => Effect.Effect<Record<string, unknown>, Error>,
  ) =>
  (input: WorkflowNodeExecutionInput) =>
    // oxlint-disable-next-line effect/effect-run-in-body -- Promise boundary bridging the Effect workflow node executors to the Promise-typed WorkflowActionExecutor RPC ABI consumed by the dynamic workflow runtime.
    Effect.runPromise(execute(input))

const workflowNodeAdapters: Partial<Record<WorkflowNodeAdapterCategory, WorkflowNodeAdapter>> = {
  network: {
    category: "network",
    execute: runNode(executeWorkflowHttpNode),
  },
  session: {
    category: "session",
    execute: runNode(executeWorkflowSessionNode),
  },
  slack: {
    category: "slack",
    execute: runNode(executeWorkflowSlackNode),
  },
  notification: {
    category: "notification",
    execute: runNode(executeWorkflowNotificationNode),
  },
  storage: {
    category: "storage",
    execute: runNode(executeWorkflowStorageNode),
  },
}

export function getRegisteredWorkflowNodeAdapterCategories(): WorkflowNodeAdapterCategory[] {
  return Object.keys(workflowNodeAdapters) as WorkflowNodeAdapterCategory[]
}

type WorkflowNodeRuntimeSupport = ReturnType<typeof getWorkflowNodeRuntimeSupport>
type AdapterRuntimeSupport = Extract<WorkflowNodeRuntimeSupport, { kind: "adapter" }>

const isAdapterRuntimeSupport = (
  runtime: WorkflowNodeRuntimeSupport,
): runtime is AdapterRuntimeSupport => runtime.kind === "adapter"

export function resolveWorkflowNodeAdapter(nodeType: string): Option.Option<WorkflowNodeAdapter> {
  return Option.some(nodeType).pipe(
    Option.filter(isWorkflowNodeType),
    Option.map(getWorkflowNodeRuntimeSupport),
    Option.filter(isAdapterRuntimeSupport),
    Option.flatMap((runtime) =>
      Option.fromNullishOr(workflowNodeAdapters[runtime.adapterCategory]),
    ),
  )
}

export async function executeWorkflowNodeWithAdapters(
  input: WorkflowNodeExecutionInput,
): Promise<Record<string, unknown>> {
  return Option.match(resolveWorkflowNodeAdapter(input.node.type), {
    onNone: () => {
      throw new Error(`Unsupported workflow action node '${input.node.type}'`)
    },
    onSome: (adapter) => adapter.execute(input),
  })
}
