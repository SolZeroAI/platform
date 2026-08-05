import { type Connection } from "@xyflow/react"
import {
  WORKFLOW_MANIFEST_VERSION,
  WORKFLOW_SUBAGENTS_MANIFEST_VERSION,
  WORKFLOW_TEMPLATES,
  type WorkflowManifest,
  type WorkflowManifestNode,
} from "@solzero/shared"
import {
  DEFAULT_SOURCE_HANDLE,
  DEFAULT_TARGET_HANDLE,
  WorkflowCanvasEdge,
  WorkflowCanvasNode,
  workflowSessionCacheTtlValues,
} from "./types"

export function createStarterNodes(): WorkflowCanvasNode[] {
  return getTemplateManifest("webhook-isolate").nodes.map(toCanvasNode)
}

export function createStarterEdges(): WorkflowCanvasEdge[] {
  return getTemplateManifest("webhook-isolate").edges.map(toCanvasEdge)
}

export function getTemplateManifest(templateId: string): WorkflowManifest {
  const template =
    WORKFLOW_TEMPLATES.find((item) => item.id === templateId) ?? WORKFLOW_TEMPLATES[0]
  return structuredClone(template.manifest)
}

export function migrateWorkflowManifestForBuilder(manifest: WorkflowManifest): WorkflowManifest {
  const manifestVersion = (manifest as { version?: unknown }).version
  if (typeof manifestVersion === "number" && manifestVersion >= WORKFLOW_MANIFEST_VERSION) {
    return manifest
  }

  const sourceVersion = typeof manifestVersion === "number" ? manifestVersion : 0

  return {
    ...manifest,
    version: WORKFLOW_MANIFEST_VERSION,
    nodes: manifest.nodes.map((node) => {
      const options = { ...node.options }
      if (sourceVersion < 2 && node.type === "r2-put-object") {
        options.encoding = "text"
      }
      if (sourceVersion < WORKFLOW_SUBAGENTS_MANIFEST_VERSION && node.type === "isolate-session") {
        options.subagents = "disabled"
      }
      return {
        ...node,
        options,
      }
    }),
  }
}

export function getIfElseConditionExpression(node: WorkflowManifestNode): string {
  if (typeof node.options.conditionExpression === "string") {
    return node.options.conditionExpression
  }
  return ""
}

export function toCanvasNode(node: WorkflowManifestNode): WorkflowCanvasNode {
  return {
    id: node.id,
    type: "workflow",
    position: node.position,
    data: { node: { ...node, options: getWorkflowNodeOptions(node) } },
  }
}

export function getManualInputValues(node: WorkflowManifestNode): Record<string, string> {
  const inputValues = node.options.inputValues
  if (!inputValues || typeof inputValues !== "object" || Array.isArray(inputValues)) {
    return {}
  }

  const values: Record<string, string> = {}
  for (const [key, value] of Object.entries(inputValues)) {
    if (typeof value === "string") {
      values[key] = value
    }
  }
  return values
}

export function hasManualInputValue(node: WorkflowManifestNode, handle: string): boolean {
  return Object.prototype.hasOwnProperty.call(getManualInputValues(node), handle)
}

export function hasWorkflowNodeInputConfigured(
  node: WorkflowManifestNode,
  edges: WorkflowCanvasEdge[],
  handle: string,
): boolean {
  return (
    hasManualInputValue(node, handle) ||
    edges.some(
      (edge) => edge.target === node.id && getNormalizedTargetHandle(edge.targetHandle) === handle,
    )
  )
}

export function getWorkflowSessionCacheTtlValue(value: unknown): string {
  const seconds =
    typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : typeof value === "string"
        ? value.trim()
        : ""
  return workflowSessionCacheTtlValues.has(seconds) ? seconds : ""
}

export function getManualInputValue(node: WorkflowManifestNode, handle: string): string {
  return getManualInputValues(node)[handle] ?? ""
}

export function setManualInputValue(
  node: WorkflowManifestNode,
  handle: string,
  value: string,
): WorkflowManifestNode {
  const inputValues = getManualInputValues(node)
  if (value === "") {
    delete inputValues[handle]
  } else {
    inputValues[handle] = value
  }

  const options = { ...node.options }
  if (Object.keys(inputValues).length > 0) {
    options.inputValues = inputValues
  } else {
    delete options.inputValues
  }
  return { ...node, options }
}

export function clearManualInputValue(
  node: WorkflowManifestNode,
  handle: string,
): WorkflowManifestNode {
  return setManualInputValue(node, handle, "")
}

export function getNormalizedSourceHandle(handle: string | null | undefined): string {
  return handle ?? DEFAULT_SOURCE_HANDLE
}

export function getNormalizedTargetHandle(handle: string | null | undefined): string {
  return handle ?? DEFAULT_TARGET_HANDLE
}

export function getEdgeTargetInputKey(
  edge: Pick<WorkflowCanvasEdge, "target" | "targetHandle">,
): string {
  return `${edge.target}:${getNormalizedTargetHandle(edge.targetHandle)}`
}

export function getConnectionTargetInputKey(connection: Connection): string {
  return `${connection.target ?? ""}:${getNormalizedTargetHandle(connection.targetHandle)}`
}

export function findEdgeUsingTargetInput(
  edges: WorkflowCanvasEdge[],
  connection: Connection,
): WorkflowCanvasEdge | null {
  const targetInputKey = getConnectionTargetInputKey(connection)
  return edges.find((edge) => getEdgeTargetInputKey(edge) === targetInputKey) ?? null
}

export function isSameConnection(edge: WorkflowCanvasEdge, connection: Connection): boolean {
  return (
    edge.source === connection.source &&
    edge.target === connection.target &&
    getNormalizedSourceHandle(edge.sourceHandle) ===
      getNormalizedSourceHandle(connection.sourceHandle) &&
    getNormalizedTargetHandle(edge.targetHandle) ===
      getNormalizedTargetHandle(connection.targetHandle)
  )
}

export function toConnectionEdge(connection: Connection) {
  return {
    ...connection,
    type: "default",
    animated: false,
  }
}

export function toCanvasEdge(edge: WorkflowManifest["edges"][number]): WorkflowCanvasEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? undefined,
    targetHandle: edge.targetHandle ?? undefined,
    type: "default",
  }
}

export function toManifest(
  name: string,
  nodes: WorkflowCanvasNode[],
  edges: WorkflowCanvasEdge[],
): WorkflowManifest {
  return {
    version: WORKFLOW_MANIFEST_VERSION,
    name,
    nodes: nodes.map((node) => {
      const manifestNode = node.data.node
      return {
        ...manifestNode,
        position: node.position,
        options: getWorkflowNodeOptions(manifestNode),
      }
    }),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? null,
      targetHandle: edge.targetHandle ?? null,
    })),
  }
}

export function getWorkflowNodeOptions(node: WorkflowManifestNode): Record<string, unknown> {
  if (node.type !== "isolate-session" && node.type !== "sandbox-session") {
    return node.options
  }
  const options = { ...node.options }
  delete options.title
  return options
}

export type WorkflowManifestEdge = WorkflowManifest["edges"][number]
