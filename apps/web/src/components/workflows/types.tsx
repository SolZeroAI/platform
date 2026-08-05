import { type Connection, type Edge, type Node, type ReactFlowInstance } from "@xyflow/react"
import { type FileContents } from "@pierre/diffs/react"
import { useEffect, useRef } from "react"
import {
  WORKFLOW_NODE_CATALOG,
  type WorkflowManifest,
  type WorkflowManifestNode,
  type WorkflowNodeCategory,
  type WorkflowNodeDefinition,
  type WorkflowNodeType,
  type WorkflowPortDefinition,
} from "@solzero/shared"
import { WorkflowCanvasNodeView } from "./builder-canvas"
import { parseWorkflowHeaderDraftRows, parseWorkflowHeaderOption } from "./header-utils"

export type WorkflowCanvasNode = Node<
  { node: WorkflowManifestNode; workflowDisabled?: boolean; hasValidationErrors?: boolean },
  "workflow"
>

export type WorkflowCanvasEdge = Edge

export type WorkflowViewTab = "overview" | "builder"

export type WorkflowCreationMode = "templates" | "import" | "ai"

export type WorkflowConnectionDetails = {
  edge: WorkflowCanvasEdge
  sourceNode: WorkflowManifestNode
  targetNode: WorkflowManifestNode
  sourcePort: WorkflowPortDefinition | null
  targetPort: WorkflowPortDefinition | null
  sourceHandle: string
  targetHandle: string
}

export type WorkflowTemplateReferenceOption = {
  id: string
  handle: string
}

export type WorkflowHeaderDraftRow = {
  id: string
  key: string
  value: string
}

export type WorkflowHeaderDraftRowErrors = Record<
  string,
  {
    key?: string
    value?: string
  }
>

export type WorkflowNodeConfigError = {
  nodeId: string
  configLabel: string
  message: string
}

export type WorkflowNodeConfigErrorDetails = WorkflowNodeConfigError & {
  nodeLabel: string
}

export type WorkflowConfigFocusTarget = {
  nodeId: string
  configLabel: string
}

export type WorkflowSortDir = "asc" | "desc"

export type WorkflowListSortBy =
  | "name"
  | "status"
  | "manifestVersion"
  | "webhookId"
  | "createdAt"
  | "updatedAt"

export type WorkflowListTableState = {
  q: string
  status: string
  sortBy: WorkflowListSortBy
  sortDir: WorkflowSortDir
  pageIndex: number
  pageSize: number
}

export type WorkflowListStatePatch = Partial<WorkflowListTableState>

export type WorkflowRunSortBy =
  | "id"
  | "workflowVersion"
  | "triggerKind"
  | "status"
  | "startedAt"
  | "completedAt"
  | "updatedAt"

export type WorkflowRunTableState = {
  q: string
  status: string
  triggerKind: string
  sortBy: WorkflowRunSortBy
  sortDir: WorkflowSortDir
  pageIndex: number
  pageSize: number
}

export type WorkflowRunStatePatch = Partial<WorkflowRunTableState>

export type WorkflowDetailLoadState =
  | {
      workflowId: string
      phase: "loading" | "ready"
    }
  | {
      workflowId: string
      phase: "error"
      message: string
    }

export const WORKFLOW_PAGE_SIZE_OPTIONS = [10, 20, 50] as const

export const WORKFLOW_STATUS_ALL_FILTER = "all"

export const WORKFLOW_STATUS_FILTER_OPTIONS = ["active", "disabled"] as const

export const WORKFLOW_RUN_STATUS_FILTER_OPTIONS = [
  "queued",
  "running",
  "completed",
  "failed",
] as const

export const WORKFLOW_RUN_TRIGGER_FILTER_OPTIONS = [
  "manual",
  "webhook",
  "datetime",
  "cron",
  "slack",
] as const

export const WORKFLOW_DEFAULT_TABLE_STATE: WorkflowListTableState = {
  q: "",
  status: "",
  sortBy: "updatedAt",
  sortDir: "desc",
  pageIndex: 0,
  pageSize: 20,
}

export const WORKFLOW_RUN_DEFAULT_TABLE_STATE: WorkflowRunTableState = {
  q: "",
  status: "",
  triggerKind: "",
  sortBy: "updatedAt",
  sortDir: "desc",
  pageIndex: 0,
  pageSize: 20,
}

export function getWorkflowNodeConfigErrorDetails(
  errorsByNode: Record<string, WorkflowNodeConfigError[]>,
  nodes: WorkflowCanvasNode[],
): WorkflowNodeConfigErrorDetails[] {
  const details: WorkflowNodeConfigErrorDetails[] = []

  for (const node of nodes) {
    const manifestNode = node.data.node
    const errors = errorsByNode[manifestNode.id] ?? []
    for (const error of errors) {
      details.push({ ...error, nodeLabel: manifestNode.label })
    }
  }

  return details
}

export function groupWorkflowNodeConfigErrors(errors: WorkflowNodeConfigErrorDetails[]): Array<{
  nodeId: string
  nodeLabel: string
  errors: WorkflowNodeConfigErrorDetails[]
}> {
  const groups = new Map<
    string,
    {
      nodeId: string
      nodeLabel: string
      errors: WorkflowNodeConfigErrorDetails[]
    }
  >()

  for (const error of errors) {
    const group = groups.get(error.nodeId) ?? {
      nodeId: error.nodeId,
      nodeLabel: error.nodeLabel,
      errors: [],
    }
    group.errors.push(error)
    groups.set(error.nodeId, group)
  }

  return Array.from(groups.values())
}

export function getWorkflowNodeConfigErrorsByNode(
  nodes: WorkflowCanvasNode[],
  headerDraftsByNode: Record<string, WorkflowHeaderDraftRow[]>,
): Record<string, WorkflowNodeConfigError[]> {
  const errorsByNode: Record<string, WorkflowNodeConfigError[]> = {}

  for (const node of nodes) {
    const manifestNode = node.data.node
    const errors = getWorkflowNodeConfigErrors(
      manifestNode,
      headerDraftsByNode[manifestNode.id] ?? null,
    )
    if (errors.length > 0) {
      errorsByNode[manifestNode.id] = errors
    }
  }

  return errorsByNode
}

export function getWorkflowNodeConfigErrors(
  node: WorkflowManifestNode,
  headerDraftRows: WorkflowHeaderDraftRow[] | null,
): WorkflowNodeConfigError[] {
  if (node.type !== "http-request") {
    return []
  }

  const validation = headerDraftRows
    ? parseWorkflowHeaderDraftRows(headerDraftRows)
    : parseWorkflowHeaderOption(node.options.headers)
  if (validation.ok) {
    return []
  }

  return validation.messages.map((message) => ({
    nodeId: node.id,
    configLabel: "Headers",
    message,
  }))
}

export const WORKFLOW_SESSION_CACHE_TTL_OPTIONS = [
  { value: "60", label: "1m" },
  { value: "300", label: "5m" },
  { value: "600", label: "10m" },
  { value: "1800", label: "30m" },
  { value: "3600", label: "1h" },
  { value: "10800", label: "3h" },
  { value: "21600", label: "6h" },
  { value: "43200", label: "12h" },
  { value: "86400", label: "1d" },
  { value: "259200", label: "3d" },
  { value: "604800", label: "7d" },
] as const

export const workflowSessionCacheTtlValues = new Set<string>(
  WORKFLOW_SESSION_CACHE_TTL_OPTIONS.map((option) => option.value),
)

export type TriggerRunRequest =
  | {
      kind: "manual"
      nodeId: string
      payload: Record<string, unknown>
    }
  | {
      kind: "webhook"
      nodeId: string
      payload: {
        body: unknown
        headers: Record<string, unknown>
        query: Record<string, unknown>
      }
    }
  | {
      kind: "datetime"
      nodeId: string
      scheduledAt: string | null
      firedAt: string
      payload: Record<string, unknown>
    }
  | {
      kind: "cron"
      nodeId: string
      cron: string | null
      scheduledAt: string | null
      firedAt: string
      payload: Record<string, unknown>
    }
  | {
      kind: "slack"
      nodeId: string
      payload: Record<string, unknown>
    }

export type WebhookTestPayload = Extract<TriggerRunRequest, { kind: "webhook" }>["payload"]
export type SlackTestTrigger = Extract<TriggerRunRequest, { kind: "slack" }>

export interface RunTriggerOptions {
  throwOnError?: boolean
}

export interface WorkflowSummary {
  id: string
  name: string
  status: "active" | "disabled" | "archived"
  manifestVersion: number
  webhookId: string
  webhookPath: string
  webhookUrl: string | null
  createdAt: number
  updatedAt: number
  manifest?: WorkflowManifest
}

export interface WorkflowSlackAppStatus {
  hasSigningSecret: boolean
  hasBotToken: boolean
}

export interface WorkflowSlackAppRequestUrls {
  events: string
  interactions: string
  commands: Record<string, string>
}

export interface WorkflowSlackManifestValidation {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export interface WorkflowSlackTriggerRegistrationSummary {
  id: string
  nodeId: string
  surface: "event" | "command" | "interaction"
  commandName: string | null
  eventTypes: unknown
  channelNamePattern: string | null
  keywordRules: unknown
  actionIds: unknown
  enabled: boolean
  updatedAt: number
}

export interface WorkflowSlackAppSetup {
  id: string
  workflowId: string
  appName: string
  status: WorkflowSlackAppStatus
  requestUrls: WorkflowSlackAppRequestUrls
  manifest: Record<string, unknown>
  validation: WorkflowSlackManifestValidation
  registrations: WorkflowSlackTriggerRegistrationSummary[]
}

export interface WorkflowManifestMigrationStep {
  fromVersion: number
  toVersion: number
  description: string
}

export interface WorkflowManifestMigrationSummary {
  fromVersion: number
  toVersion: number
  steps: WorkflowManifestMigrationStep[]
}

export interface WorkflowSaveResponse {
  workflow: WorkflowSummary
  manifestMigration?: WorkflowManifestMigrationSummary
}

export interface WorkflowSaveChangeSummary {
  title: string
  details: WorkflowSaveChangeDetailSummary[]
  subject?: WorkflowSaveChangeSubject
  badge?: WorkflowSaveChangeBadge
}

export interface WorkflowSaveChangeDetailSummary {
  label: string
  revertAction?: WorkflowSaveRevertAction
  diff?: WorkflowSaveChangeDetailDiff
}

export interface WorkflowSaveChangeDetailDiff {
  title: string
  oldFile: FileContents
  newFile: FileContents
}

export interface WorkflowSaveChangeSubject {
  kind: "node"
  label: string
  type: WorkflowNodeType
  category: WorkflowNodeCategory
}

export type WorkflowSaveChangeBadge = "deleted"

export type WorkflowSaveRevertAction =
  | {
      kind: "workflow-name"
      previousName: string
    }
  | {
      kind: "node-label"
      nodeId: string
      previousLabel: string
    }
  | {
      kind: "node-type"
      nodeId: string
      previousType: WorkflowNodeType
    }
  | {
      kind: "node-input-values"
      nodeId: string
      previousInputValues: Record<string, unknown>
    }
  | {
      kind: "node-options"
      nodeId: string
      previousOptions: Record<string, unknown>
      optionKeys: string[]
    }
  | {
      kind: "node-position"
      nodeId: string
      previousPosition: WorkflowManifestNode["position"]
    }

export interface WorkflowSaveDialogSummary {
  changes: WorkflowSaveChangeSummary[]
  systemChanges: WorkflowSaveChangeSummary[]
  workflowVersion: string
  runtimeVersionChange: WorkflowRuntimeVersionChange | null
}

export interface WorkflowRuntimeVersionChange {
  fromVersion: number
  toVersion: number
}

export type WorkflowSaveDialogState =
  | {
      phase: "confirm" | "saving"
      summary: WorkflowSaveDialogSummary
    }
  | {
      phase: "failure"
      summary: WorkflowSaveDialogSummary
      error: string
    }

export function upsertWorkflowSummary(
  workflows: WorkflowSummary[],
  workflow: WorkflowSummary,
): WorkflowSummary[] {
  return workflows.some((item) => item.id === workflow.id)
    ? workflows.map((item) => (item.id === workflow.id ? workflow : item))
    : [workflow, ...workflows]
}

export interface WorkflowRun {
  id: string
  workflowId: string
  workflowVersion: number
  workflowInstanceId: string | null
  status: string
  triggerKind: string
  triggerNodeId: string | null
  input: Record<string, unknown>
  output: Record<string, unknown> | null
  startedAt: number
  completedAt: number | null
  updatedAt: number
  error: string | null
}

export interface WorkflowRunArtifactSummary {
  id: string
  workflowId: string
  runId: string
  nodeId: string
  title: string
  subtitle: string
  nodeType: Extract<WorkflowNodeType, "r2-put-object" | "kv-put">
  output: Record<string, unknown>
}

export interface WorkflowRunArtifactContent {
  nodeId: string
  nodeType: Extract<WorkflowNodeType, "r2-put-object" | "kv-put">
  storageType: "r2" | "kv"
  binding: string
  key: string
  contentType: string | null
  etag: string | null
  content: unknown
  text: string
}

export interface WorkflowRunEvent {
  id: string
  sequence: number
  nodeId: string | null
  eventType: string
  level: string
  message: string
  data: Record<string, unknown>
  createdAt: number
}

export interface WorkflowRunSnapshot {
  runs: WorkflowRun[]
  runId: string | null
  events: WorkflowRunEvent[]
  serverTime: number
}

export interface WorkflowBuilderDraft {
  sessionId: string
  manifest: WorkflowManifest
  validation: {
    valid: boolean
    errors: string[]
    warnings: string[]
    executionOrder: string[]
  }
  submittedAt: string
}

export interface PendingConnectionReplacement {
  connection: Connection
  existingEdge: WorkflowCanvasEdge
}

export interface PendingManualInputOverwrite {
  connection: Connection
  targetNode: WorkflowManifestNode
  targetHandle: string
}

export const nodeTypes = {
  workflow: WorkflowCanvasNodeView,
}

export const REACT_FLOW_PRO_OPTIONS = { hideAttribution: true } as const

export const HTTP_METHOD_OPTIONS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].map(
  (method) => ({ value: method, label: method }),
)

export const HTTP_RESPONSE_TYPE_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "json", label: "JSON" },
  { value: "text", label: "Text" },
]

export const HTTP_ERROR_OPTIONS = [
  { value: "false", label: "Keep response" },
  { value: "true", label: "Fail run" },
]

export const SLACK_TRIGGER_SURFACE_OPTIONS = [
  { value: "event", label: "Event" },
  { value: "command", label: "Slash command" },
  { value: "interaction", label: "Interaction" },
]

export const DEFAULT_SOURCE_HANDLE = "result"

export const DEFAULT_TARGET_HANDLE = "input"

export const WORKFLOW_NODE_CATEGORY_ORDER: WorkflowNodeCategory[] = [
  "trigger",
  "logic",
  "network",
  "session",
  "slack",
  "notification",
  "storage",
]

export const WORKFLOW_NODE_CATEGORY_LABELS: Record<WorkflowNodeCategory, string> = {
  trigger: "Triggers",
  logic: "Logic",
  network: "Network",
  session: "Agents",
  slack: "Slack",
  notification: "Notifications",
  storage: "Storage",
}

export type WorkflowNodeCatalogItem = {
  id: WorkflowNodeType
  category: WorkflowNodeCategory
  definition: WorkflowNodeDefinition
  disabledReason?: string
}

const WORKFLOW_NODE_CATALOG_DISABLED_REASONS: Partial<Record<WorkflowNodeType, string>> = {
  "email-notification": "Coming soon",
}

export const WORKFLOW_NODE_CATALOG_ITEMS: WorkflowNodeCatalogItem[] = WORKFLOW_NODE_CATALOG.map(
  (definition) => {
    const disabledReason = WORKFLOW_NODE_CATALOG_DISABLED_REASONS[definition.type]
    return {
      id: definition.type,
      category: definition.category,
      definition: disabledReason
        ? { ...definition, label: `${definition.label} (coming soon)` }
        : definition,
      disabledReason,
    }
  },
)

export const WORKFLOW_CREATION_DIALOG_CONFIG: Record<
  WorkflowCreationMode,
  {
    title: string
    description: string
    size: "lg" | "xl"
    className: string
  }
> = {
  templates: {
    title: "Template",
    description: "Choose a proven workflow shape and customize the nodes.",
    size: "xl",
    className: "flex max-h-[85vh] w-full max-w-4xl flex-col p-0",
  },
  ai: {
    title: "Build with AI",
    description: "Describe the trigger, tools, storage, and expected output.",
    size: "lg",
    className: "flex max-h-[85vh] w-full max-w-2xl flex-col p-0",
  },
  import: {
    title: "Import",
    description: "Load a SolZero workflow YAML export as an editable draft.",
    size: "lg",
    className: "flex max-h-[85vh] w-full max-w-xl flex-col p-0",
  },
}

export const WORKFLOW_TEMPLATE_COMPLEXITY_GROUPS = [
  { complexity: "simple", label: "Simple" },
  { complexity: "moderate", label: "Moderate" },
  { complexity: "complex", label: "Complex" },
] as const

export const GROUPED_WORKFLOW_NODE_CATALOG = WORKFLOW_NODE_CATEGORY_ORDER.map((category) => ({
  category,
  items: WORKFLOW_NODE_CATALOG_ITEMS.filter((item) => item.category === category),
})).filter((group) => group.items.length > 0)

export const CATALOG_PREVIEW_VIEWPORT_MARGIN = 12

export const CATALOG_PREVIEW_OFFSET = 18

export const CATALOG_PREVIEW_ESTIMATED_HEIGHT = 220

export const WORKFLOW_LEFT_PANEL_WIDTH = 360

export const WORKFLOW_NODE_DRAG_MIME_TYPE = "application/x-s0-workflow-node"

export const WORKFLOW_NODE_ESTIMATED_SIZE = { width: 192, height: 112 }

export const WORKFLOW_NODE_CENTER_DURATION_MS = 240

export const WORKFLOW_CANVAS_MIN_ZOOM = 0.1

export const WORKFLOW_CANVAS_FIT_VIEW_OPTIONS = { padding: 0.15 } as const

export const WORKFLOW_DETAIL_PATH_PATTERN = /^\/workflows\/([^/]+)\/?$/

export function getCatalogPreviewTop(
  anchorTop: number,
  anchorHeight: number,
  previewHeight: number,
) {
  const minTop = CATALOG_PREVIEW_VIEWPORT_MARGIN
  const maxTop = Math.max(
    minTop,
    window.innerHeight - previewHeight - CATALOG_PREVIEW_VIEWPORT_MARGIN,
  )
  const centeredTop = anchorTop + anchorHeight / 2 - previewHeight / 2
  return Math.min(Math.max(centeredTop, minTop), maxTop)
}

export function hasWorkflowNodeDragData(dataTransfer: DataTransfer) {
  return Array.from(dataTransfer.types).includes(WORKFLOW_NODE_DRAG_MIME_TYPE)
}

export function getWorkflowNodeDragType(dataTransfer: DataTransfer): WorkflowNodeType | null {
  const type = dataTransfer.getData(WORKFLOW_NODE_DRAG_MIME_TYPE)
  return isWorkflowNodeType(type) ? type : null
}

export function isWorkflowNodeType(type: string): type is WorkflowNodeType {
  return WORKFLOW_NODE_CATALOG_ITEMS.some((item) => item.id === type)
}

export function getWorkflowNodePositionCenter(position: WorkflowManifestNode["position"]) {
  return {
    x: position.x + WORKFLOW_NODE_ESTIMATED_SIZE.width / 2,
    y: position.y + WORKFLOW_NODE_ESTIMATED_SIZE.height / 2,
  }
}

export function getWorkflowCanvasNodeCenter(node: WorkflowCanvasNode) {
  const width = node.measured?.width ?? node.width ?? WORKFLOW_NODE_ESTIMATED_SIZE.width
  const height = node.measured?.height ?? node.height ?? WORKFLOW_NODE_ESTIMATED_SIZE.height
  return {
    x: node.position.x + width / 2,
    y: node.position.y + height / 2,
  }
}

export function centerWorkflowCanvasViewport(
  reactFlowInstance: ReactFlowInstance<WorkflowCanvasNode, WorkflowCanvasEdge>,
  center: WorkflowManifestNode["position"],
) {
  void reactFlowInstance.setCenter(center.x, center.y, {
    duration: WORKFLOW_NODE_CENTER_DURATION_MS,
    zoom: reactFlowInstance.getZoom(),
  })
}

export function useDeleteConfirmationShortcut(onConfirm: () => void) {
  const confirmedRef = useRef(false)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Backspace" && event.key !== "Delete") {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      if (confirmedRef.current) {
        return
      }

      confirmedRef.current = true
      onConfirm()
    }

    window.addEventListener("keydown", handleKeyDown, true)
    return () => window.removeEventListener("keydown", handleKeyDown, true)
  }, [onConfirm])
}

export function getRouteWorkflowId(pathname: string) {
  const match = WORKFLOW_DETAIL_PATH_PATTERN.exec(pathname)
  return match ? decodeURIComponent(match[1]) : undefined
}
