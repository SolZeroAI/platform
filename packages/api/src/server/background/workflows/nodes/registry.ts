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
import { runEffectPromise } from "../../../lib/effect-promise"
import * as Option from "effect/Option"

export interface WorkflowNodeAdapter {
  category: WorkflowNodeAdapterCategory
  execute(input: WorkflowNodeExecutionInput): Promise<Record<string, unknown>>
}

const workflowNodeAdapters: Partial<Record<WorkflowNodeAdapterCategory, WorkflowNodeAdapter>> = {
  network: {
    category: "network",
    execute: (input) => runEffectPromise(executeWorkflowHttpNode(input)),
  },
  session: {
    category: "session",
    execute: (input) => runEffectPromise(executeWorkflowSessionNode(input)),
  },
  slack: {
    category: "slack",
    execute: (input) => runEffectPromise(executeWorkflowSlackNode(input)),
  },
  notification: {
    category: "notification",
    execute: (input) => runEffectPromise(executeWorkflowNotificationNode(input)),
  },
  storage: {
    category: "storage",
    execute: (input) => runEffectPromise(executeWorkflowStorageNode(input)),
  },
}

export function getRegisteredWorkflowNodeAdapterCategories(): WorkflowNodeAdapterCategory[] {
  return /* SAFETY: These keys are exactly the members of WorkflowNodeAdapterCategory[]. */ Object.keys(
    workflowNodeAdapters,
  ) as WorkflowNodeAdapterCategory[]
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
