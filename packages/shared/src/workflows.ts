import {
  WORKFLOW_MANIFEST_VERSION,
  WORKFLOW_SUBAGENTS_MANIFEST_VERSION,
  type WorkflowDraftValidationResult,
  type WorkflowExportDocument,
  type WorkflowManifest,
  type WorkflowManifestEdge,
  type WorkflowManifestNode,
} from "./workflows/manifest-types"
import {
  getWorkflowNodeDefinition,
  getWorkflowNodeDefinitionForNode,
  isWorkflowNodeType,
  validateWorkflowNodeOptions,
  validateWorkflowNodeTemplateReferences,
} from "./workflow-nodes"
import { parse as parseYaml, stringify as stringifyYaml } from "yaml"

export {
  getWorkflowNodeDefinition,
  getWorkflowNodeDefinitionForNode,
  getWorkflowNodeRuntimeSupport,
  getNextWorkflowJsonObjectFieldName,
  getWorkflowJsonObjectFields,
  getWorkflowNodeDefaultOptions,
  isWorkflowActionNodeType,
  isWorkflowNodeType,
  isWorkflowTriggerNodeType,
  validateWorkflowJsonObjectFieldName,
  WORKFLOW_JSON_OBJECT_FIELD_NAME_PATTERN,
  WORKFLOW_NODE_CATALOG,
  WORKFLOW_NODE_CATALOG_COMPLETE,
  WORKFLOW_NODE_TYPES,
  WORKFLOW_KV_NAMESPACE_OPTIONS,
  WORKFLOW_R2_BUCKET_OPTIONS,
  WORKFLOW_STORAGE_ENCODING_OPTIONS,
} from "./workflow-nodes"
export type {
  WorkflowActionNodeType,
  WorkflowNodeAdapterCategory,
  WorkflowKvNamespaceBinding,
  WorkflowNodeCategory,
  WorkflowNodeDefaultOptionsDefinition,
  WorkflowNodeDefinition,
  WorkflowNodeEditorConfiguration,
  WorkflowNodeEditorIcon,
  WorkflowNodeEditorSupport,
  WorkflowNodeInlineExecutor,
  WorkflowNodeOptionValidationRule,
  WorkflowNodeRuntimeSupport,
  WorkflowNodeType,
  WorkflowNodeTriggerKind,
  WorkflowNodeValidationSupport,
  WorkflowPortDefinition,
  WorkflowR2BucketBinding,
  WorkflowStorageEncoding,
  WorkflowTriggerNodeType,
} from "./workflow-nodes"

export {
  WORKFLOW_MANIFEST_VERSION,
  WORKFLOW_SUBAGENTS_MANIFEST_VERSION,
} from "./workflows/manifest-types"
export type {
  WorkflowCronTriggerOptions,
  WorkflowDateTimeTriggerOptions,
  WorkflowDraftValidationResult,
  WorkflowEmailNotificationOptions,
  WorkflowExportDocument,
  WorkflowGetSecretOptions,
  WorkflowHttpRequestOptions,
  WorkflowIfElseNodeOptions,
  WorkflowJavaScriptNodeOptions,
  WorkflowJsonObjectOptions,
  WorkflowKvGetOptions,
  WorkflowKvPutOptions,
  WorkflowManifest,
  WorkflowManifestEdge,
  WorkflowManifestNode,
  WorkflowR2GetObjectOptions,
  WorkflowR2PutObjectOptions,
  WorkflowSessionNodeOptions,
  WorkflowSlackAddReactionOptions,
  WorkflowSlackFetchThreadOptions,
  WorkflowSlackJoinChannelOptions,
  WorkflowSlackNotificationOptions,
  WorkflowSlackRemoveReactionOptions,
  WorkflowSlackSendMessageOptions,
  WorkflowSlackTriggerOptions,
  WorkflowSlackTriggerSurface,
  WorkflowTemplate,
  WorkflowTemplateComplexity,
  WorkflowUserApprovalOptions,
} from "./workflows/manifest-types"
export { WORKFLOW_TEMPLATES } from "./workflows/templates"
const WORKFLOW_R2_CONTENT_ENCODING_MANIFEST_VERSION = 2

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function normalizeWorkflowDraftNode(value: unknown, index: number): WorkflowManifestNode {
  if (!isRecord(value)) {
    throw new Error(`Workflow node at index ${index} must be an object`)
  }

  const type = readString(value.type)
  if (!isWorkflowNodeType(type)) {
    throw new Error(
      `Workflow node '${readString(value.id, String(index))}' has invalid type '${type}'`,
    )
  }

  const id = readString(value.id, `node-${index + 1}`).trim()
  if (!id) {
    throw new Error(`Workflow node at index ${index} must have an id`)
  }

  const position = isRecord(value.position) ? value.position : {}

  return {
    id,
    type,
    label: readString(value.label, getWorkflowNodeDefinition(type).label),
    position: {
      x: readNumber(position.x, 120 + index * 80),
      y: readNumber(position.y, 120 + index * 40),
    },
    options: isRecord(value.options) ? value.options : {},
  }
}

function normalizeWorkflowDraftNodeForManifestVersion(
  node: WorkflowManifestNode,
  manifestVersion: number,
): WorkflowManifestNode {
  const normalizeR2Encoding =
    manifestVersion < WORKFLOW_R2_CONTENT_ENCODING_MANIFEST_VERSION && node.type === "r2-put-object"
  const normalizeIsolateSubagents =
    manifestVersion < WORKFLOW_SUBAGENTS_MANIFEST_VERSION && node.type === "isolate-session"
  if (!normalizeR2Encoding && !normalizeIsolateSubagents) {
    return node
  }

  return {
    ...node,
    options: {
      ...node.options,
      ...(normalizeR2Encoding ? { encoding: "text" } : {}),
      ...(normalizeIsolateSubagents ? { subagents: "disabled" } : {}),
    },
  }
}

function normalizeWorkflowDraftEdge(
  value: unknown,
  index: number,
  nodeById: Map<string, WorkflowManifestNode>,
): WorkflowManifestEdge {
  if (!isRecord(value)) {
    throw new Error(`Workflow edge at index ${index} must be an object`)
  }

  const source = readString(value.source).trim()
  const target = readString(value.target).trim()
  if (!source || !target) {
    throw new Error(`Workflow edge at index ${index} must have source and target`)
  }
  const sourceNode = nodeById.get(source)
  const targetNode = nodeById.get(target)
  if (!sourceNode) {
    throw new Error(`Workflow edge '${source}->${target}' references unknown source node`)
  }
  if (!targetNode) {
    throw new Error(`Workflow edge '${source}->${target}' references unknown target node`)
  }

  const id = readString(value.id, `edge-${source}-${target}-${index}`)
  const sourceHandle = normalizeWorkflowEdgeHandle(value.sourceHandle)
  const targetHandle = normalizeWorkflowEdgeHandle(value.targetHandle)
  validateWorkflowEdgeHandle({
    edgeId: id,
    node: sourceNode,
    handle: sourceHandle,
    direction: "source",
  })
  validateWorkflowEdgeHandle({
    edgeId: id,
    node: targetNode,
    handle: targetHandle,
    direction: "target",
  })

  return {
    id,
    source,
    target,
    sourceHandle,
    targetHandle,
  }
}

function normalizeWorkflowEdgeHandle(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function validateWorkflowEdgeHandle(input: {
  edgeId: string
  node: WorkflowManifestNode
  handle: string | null
  direction: "source" | "target"
}): void {
  if (!input.handle) {
    return
  }

  const definition = getWorkflowNodeDefinitionForNode(input.node)
  const ports = input.direction === "source" ? definition.outputs : definition.inputs
  if (ports.some((port) => port.id === input.handle)) {
    return
  }

  throw new Error(
    `Workflow edge '${input.edgeId}' references unknown ${input.direction} handle '${input.handle}' on node '${input.node.id}'`,
  )
}

function normalizeWorkflowDraftManifest(input: unknown, fallbackName: string): WorkflowManifest {
  if (!isRecord(input)) {
    throw new Error("Workflow manifest must be an object")
  }

  const rawNodes = Array.isArray(input.nodes) ? input.nodes : []
  const manifestVersion = readNumber(input.version, 0)
  const nodes = rawNodes
    .map(normalizeWorkflowDraftNode)
    .map((node) => normalizeWorkflowDraftNodeForManifestVersion(node, manifestVersion))
  if (nodes.length === 0) {
    throw new Error("Workflow manifest must include at least one node")
  }

  const nodeIds = new Set<string>()
  nodes.forEach((node) => {
    if (nodeIds.has(node.id)) {
      throw new Error(`Duplicate workflow node id '${node.id}'`)
    }
    nodeIds.add(node.id)
  })

  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const rawEdges = Array.isArray(input.edges) ? input.edges : []
  const edges = rawEdges.map((edge, index) => normalizeWorkflowDraftEdge(edge, index, nodeById))
  const name = readString(input.name, fallbackName).trim() || fallbackName

  return {
    version: WORKFLOW_MANIFEST_VERSION,
    name,
    nodes,
    edges,
  }
}

export function getWorkflowExecutionOrder(manifest: WorkflowManifest): string[] {
  const nodeIds = new Set(manifest.nodes.map((node) => node.id))
  const inDegree = new Map(manifest.nodes.map((node) => [node.id, 0]))
  const outgoing = new Map<string, string[]>()

  manifest.edges.forEach((edge) => {
    if (!nodeIds.has(edge.source)) {
      throw new Error(`Workflow edge '${edge.id}' references unknown source node '${edge.source}'`)
    }
    if (!nodeIds.has(edge.target)) {
      throw new Error(`Workflow edge '${edge.id}' references unknown target node '${edge.target}'`)
    }
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1)
    const current = outgoing.get(edge.source) ?? []
    current.push(edge.target)
    outgoing.set(edge.source, current)
  })

  const nodeById = new Map(manifest.nodes.map((node) => [node.id, node]))
  const initialQueue = manifest.nodes.filter((node) => (inDegree.get(node.id) ?? 0) === 0)
  const order: string[] = []

  // Kahn's topological sort. Recursion walks the worklist front-to-back, appending
  // newly-ready nodes (in-degree just hit zero) to the back, mirroring queue semantics.
  function processQueue(queue: typeof initialQueue): void {
    if (queue.length === 0) {
      return
    }
    const [node, ...rest] = queue
    order.push(node.id)

    const newlyReady: typeof initialQueue = []
    ;(outgoing.get(node.id) ?? []).forEach((targetId) => {
      const nextDegree = (inDegree.get(targetId) ?? 0) - 1
      inDegree.set(targetId, nextDegree)
      if (nextDegree === 0) {
        const target = nodeById.get(targetId)
        if (target) {
          newlyReady.push(target)
        }
      }
    })

    processQueue([...rest, ...newlyReady])
  }
  processQueue(initialQueue)

  if (order.length !== manifest.nodes.length) {
    throw new Error("Workflow graph contains a cycle")
  }

  return order
}

export function validateWorkflowDraft(input: unknown): WorkflowDraftValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // oxlint-disable-next-line effect/avoid-try-catch -- Synchronous, non-Effect boundary that captures manifest normalization/validation throws as structured validation errors; this module is intentionally Effect-free so the c0 control-flow rules stay inactive, and wrapping in Effect would force an effect import across the whole file.
  try {
    const manifest = normalizeWorkflowDraftManifest(input, "Imported workflow")
    const optionValidation = validateWorkflowNodeOptions(manifest)
    warnings.push(...optionValidation.warnings)
    errors.push(...optionValidation.errors)
    errors.push(...validateWorkflowNodeTemplateReferences(manifest))
    if (errors.length > 0) {
      return {
        valid: false,
        errors,
        warnings,
        executionOrder: [],
      }
    }
    const executionOrder = getWorkflowExecutionOrder(manifest)
    return {
      valid: true,
      errors,
      warnings,
      executionOrder,
      manifest,
    }
  } catch (errorValue) {
    errors.push(errorValue instanceof Error ? errorValue.message : "Invalid workflow manifest")
    return {
      valid: false,
      errors,
      warnings,
      executionOrder: [],
    }
  }
}

export function createWorkflowExportDocument(input: {
  manifest: WorkflowManifest
  exportedAt?: string
  sourceManifestVersion?: number
}): WorkflowExportDocument {
  const validation = validateWorkflowDraft(input.manifest)
  if (!validation.valid || !validation.manifest) {
    throw new Error(validation.errors[0] ?? "Invalid workflow manifest")
  }

  return {
    kind: "c0.workflow",
    exportVersion: 1,
    name: validation.manifest.name,
    manifest: validation.manifest,
    executionOrder: validation.executionOrder,
    metadata: {
      exportedAt: input.exportedAt ?? new Date().toISOString(),
      sourceManifestVersion: input.sourceManifestVersion ?? validation.manifest.version,
    },
  }
}

export function serializeWorkflowExport(input: {
  manifest: WorkflowManifest
  exportedAt?: string
  sourceManifestVersion?: number
}): string {
  return stringifyYaml(createWorkflowExportDocument(input), {
    lineWidth: 0,
    sortMapEntries: false,
  })
}

export function parseWorkflowExport(source: string): WorkflowExportDocument {
  const parsed = parseYaml(source) as unknown
  if (!isRecord(parsed)) {
    throw new Error("Workflow export must be a YAML object")
  }
  if (parsed.kind !== "c0.workflow") {
    throw new Error("Workflow export kind must be 'c0.workflow'")
  }
  if (parsed.exportVersion !== 1) {
    throw new Error("Unsupported workflow export version")
  }

  const manifest = normalizeWorkflowDraftManifest(
    parsed.manifest,
    readString(parsed.name, "Workflow"),
  )
  const validation = validateWorkflowDraft(manifest)
  if (!validation.valid || !validation.manifest) {
    throw new Error(validation.errors[0] ?? "Invalid workflow manifest")
  }

  return {
    kind: "c0.workflow",
    exportVersion: 1,
    name: readString(parsed.name, validation.manifest.name),
    manifest: validation.manifest,
    executionOrder: validation.executionOrder,
    metadata: {
      exportedAt:
        isRecord(parsed.metadata) && typeof parsed.metadata.exportedAt === "string"
          ? parsed.metadata.exportedAt
          : new Date().toISOString(),
      sourceManifestVersion:
        isRecord(parsed.metadata) && typeof parsed.metadata.sourceManifestVersion === "number"
          ? parsed.metadata.sourceManifestVersion
          : validation.manifest.version,
    },
  }
}
