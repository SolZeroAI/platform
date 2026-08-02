import { Input } from "@cloudflare/kumo/components/input"
import { Label } from "@cloudflare/kumo/components/label"
import { type Node, Position } from "@xyflow/react"
import { Save } from "lucide-react"
import {
  getWorkflowNodeDefinitionForNode,
  type WorkflowManifest,
  type WorkflowManifestNode,
} from "@c0-agent/shared"
import {
  WorkflowRuntimeVersionChange,
  WorkflowSaveChangeBadge,
  WorkflowSaveChangeDetailDiff,
  WorkflowSaveChangeDetailSummary,
  WorkflowSaveChangeSubject,
  WorkflowSaveChangeSummary,
  WorkflowSaveRevertAction,
  WorkflowSlackTriggerRegistrationSummary,
  WorkflowSummary,
} from "./types"
import {
  getNormalizedSourceHandle,
  getNormalizedTargetHandle,
  WorkflowManifestEdge,
} from "./manifest-utils"
import { asJsonRecord, formatJson } from "./header-utils"

export const WORKFLOW_SAVE_CHANGE_DETAIL_LIMIT = 5

export const WORKFLOW_RUNTIME_VERSION_DESCRIPTION =
  "This updates the workflow to the latest runner format. Future runs use the new version after you save. Runs already in progress keep using the version they started with."

export function getWorkflowSaveChangeSummary(
  previousManifest: WorkflowManifest | null,
  nextManifest: WorkflowManifest,
  options: { includeFallback?: boolean } = {},
): WorkflowSaveChangeSummary[] {
  const includeFallback = options.includeFallback ?? true

  if (!previousManifest) {
    return [
      createWorkflowSaveChange(`Create workflow "${nextManifest.name}"`, [
        `${pluralizeCount(nextManifest.nodes.length, "node")} in the draft`,
        `${pluralizeCount(nextManifest.edges.length, "connection")} in the draft`,
      ]),
    ]
  }

  const changes: WorkflowSaveChangeSummary[] = []
  if (previousManifest.name !== nextManifest.name) {
    changes.push(
      createWorkflowSaveChange("Rename workflow", [
        createWorkflowSaveChangeDetail(
          `"${previousManifest.name}" -> "${nextManifest.name}"`,
          {
            kind: "workflow-name",
            previousName: previousManifest.name,
          },
          createWorkflowSaveChangeTextDiff(
            "Rename workflow",
            "workflow-name.txt",
            previousManifest.name,
            nextManifest.name,
          ),
        ),
      ]),
    )
  }

  const previousNodes = new Map(previousManifest.nodes.map((node) => [node.id, node]))
  const nextNodes = new Map(nextManifest.nodes.map((node) => [node.id, node]))
  const addedNodes = nextManifest.nodes.filter((node) => !previousNodes.has(node.id))
  const removedNodes = previousManifest.nodes.filter((node) => !nextNodes.has(node.id))
  const changedNodes = nextManifest.nodes.filter((node) => {
    const previousNode = previousNodes.get(node.id)
    return previousNode ? formatJson(previousNode) !== formatJson(node) : false
  })

  const previousEdges = new Map(previousManifest.edges.map((edge) => [edge.id, edge]))
  const nextEdges = new Map(nextManifest.edges.map((edge) => [edge.id, edge]))
  const addedEdges = nextManifest.edges.filter((edge) => !previousEdges.has(edge.id))
  const removedEdges = previousManifest.edges.filter((edge) => !nextEdges.has(edge.id))
  const changedEdges = nextManifest.edges.filter((edge) => {
    const previousEdge = previousEdges.get(edge.id)
    return previousEdge ? formatJson(previousEdge) !== formatJson(edge) : false
  })

  if (addedNodes.length > 0) {
    for (const node of addedNodes) {
      changes.push(
        createWorkflowSaveChange(
          `Add node "${formatWorkflowNodeLabel(node)}"`,
          [
            `Type: ${formatWorkflowNodeType(node)}`,
            `ID: ${node.id}`,
            ...getWorkflowNodeOptionDetails("Options", node.options),
            `Position: ${formatWorkflowPosition(node.position)}`,
          ],
          getWorkflowNodeSaveChangeSubject(node),
        ),
      )
    }
  }
  if (removedNodes.length > 0) {
    for (const node of removedNodes) {
      changes.push(
        createWorkflowSaveChange(
          `Remove node "${formatWorkflowNodeLabel(node)}"`,
          [
            `Type: ${formatWorkflowNodeType(node)}`,
            `ID: ${node.id}`,
            `Position: ${formatWorkflowPosition(node.position)}`,
          ],
          getWorkflowNodeSaveChangeSubject(node),
          "deleted",
        ),
      )
    }
  }
  if (changedNodes.length > 0) {
    for (const node of changedNodes) {
      const previousNode = previousNodes.get(node.id)
      if (previousNode) {
        changes.push(
          createWorkflowSaveChange(
            `Update node "${formatWorkflowNodeLabel(node)}"`,
            getWorkflowNodeChangeDetails(previousNode, node),
            getWorkflowNodeSaveChangeSubject(node),
          ),
        )
      }
    }
  }
  if (addedEdges.length > 0) {
    for (const edge of addedEdges) {
      changes.push(
        createWorkflowSaveChange("Add connection", [formatWorkflowConnection(edge, nextManifest)]),
      )
    }
  }
  if (removedEdges.length > 0) {
    for (const edge of removedEdges) {
      changes.push(
        createWorkflowSaveChange("Remove connection", [
          formatWorkflowConnection(edge, previousManifest),
        ]),
      )
    }
  }
  if (changedEdges.length > 0) {
    for (const edge of changedEdges) {
      const previousEdge = previousEdges.get(edge.id)
      if (previousEdge) {
        changes.push(
          createWorkflowSaveChange(
            "Update connection",
            getWorkflowEdgeChangeDetails(previousEdge, edge, previousManifest, nextManifest),
          ),
        )
      }
    }
  }

  return changes.length > 0
    ? changes
    : includeFallback
      ? [createWorkflowSaveChange("Save manifest metadata changes")]
      : []
}

export function stripWorkflowSaveChangeRevertActions(
  changes: WorkflowSaveChangeSummary[],
): WorkflowSaveChangeSummary[] {
  return changes.map((change) => ({
    ...change,
    details: change.details.map((detail) => ({ label: detail.label })),
  }))
}

export function createWorkflowSaveChange(
  title: string,
  details: WorkflowSaveChangeDetailInput[] = [],
  subject?: WorkflowSaveChangeSubject,
  badge?: WorkflowSaveChangeBadge,
): WorkflowSaveChangeSummary {
  return {
    title,
    details: capWorkflowSaveChangeDetails(
      details.map(normalizeWorkflowSaveChangeDetail).filter((detail) => detail.label),
    ),
    subject,
    badge,
  }
}

export type WorkflowSaveChangeDetailInput = string | WorkflowSaveChangeDetailSummary

export function normalizeWorkflowSaveChangeDetail(
  detail: WorkflowSaveChangeDetailInput,
): WorkflowSaveChangeDetailSummary {
  return typeof detail === "string" ? { label: detail } : detail
}

export function createWorkflowSaveChangeDetail(
  label: string,
  revertAction?: WorkflowSaveRevertAction,
  diff?: WorkflowSaveChangeDetailDiff,
): WorkflowSaveChangeDetailSummary {
  return { label, ...(revertAction ? { revertAction } : {}), ...(diff ? { diff } : {}) }
}

export function createWorkflowSaveChangeJsonDiff(
  title: string,
  fileName: string,
  previousValue: unknown,
  nextValue: unknown,
): WorkflowSaveChangeDetailDiff {
  return createWorkflowSaveChangeTextDiff(
    title,
    fileName,
    formatJson(previousValue),
    formatJson(nextValue),
    "json",
  )
}

export function createWorkflowSaveChangeTextDiff(
  title: string,
  fileName: string,
  previousValue: string,
  nextValue: string,
  language: "json" | "text" = "text",
): WorkflowSaveChangeDetailDiff {
  return {
    title,
    oldFile: {
      name: fileName,
      contents: previousValue,
      lang: language,
      cacheKey: `old:${fileName}:${previousValue}`,
    },
    newFile: {
      name: fileName,
      contents: nextValue,
      lang: language,
      cacheKey: `new:${fileName}:${nextValue}`,
    },
  }
}

export function getWorkflowNodeOptionDiffValue(
  options: Record<string, unknown>,
  optionKey: string,
): Record<string, unknown> {
  return Object.prototype.hasOwnProperty.call(options, optionKey)
    ? { [optionKey]: options[optionKey] }
    : {}
}

export function capWorkflowSaveChangeDetails(
  details: WorkflowSaveChangeDetailSummary[],
): WorkflowSaveChangeDetailSummary[] {
  if (details.length <= WORKFLOW_SAVE_CHANGE_DETAIL_LIMIT) {
    return details
  }
  const visibleDetails = details.slice(0, WORKFLOW_SAVE_CHANGE_DETAIL_LIMIT)
  const hiddenDetails = details.slice(WORKFLOW_SAVE_CHANGE_DETAIL_LIMIT)
  const hiddenRevertableDetails = hiddenDetails.filter((detail) => detail.revertAction)
  const hiddenNonRevertableDetailCount = hiddenDetails.length - hiddenRevertableDetails.length

  return [
    ...visibleDetails,
    ...hiddenRevertableDetails,
    ...(hiddenNonRevertableDetailCount > 0
      ? [{ label: `${hiddenNonRevertableDetailCount} more details` }]
      : []),
  ]
}

export function applyWorkflowSaveRevertAction(
  manifest: WorkflowManifest,
  action: WorkflowSaveRevertAction,
): WorkflowManifest {
  switch (action.kind) {
    case "workflow-name":
      return { ...manifest, name: action.previousName }
    case "node-label":
      return updateWorkflowManifestNode(manifest, action.nodeId, (node) => ({
        ...node,
        label: action.previousLabel,
      }))
    case "node-type":
      return updateWorkflowManifestNode(manifest, action.nodeId, (node) => ({
        ...node,
        type: action.previousType,
      }))
    case "node-input-values":
      return updateWorkflowManifestNode(manifest, action.nodeId, (node) => ({
        ...node,
        options: restoreWorkflowNodeInputValues(node.options, action.previousInputValues),
      }))
    case "node-options":
      return updateWorkflowManifestNode(manifest, action.nodeId, (node) => ({
        ...node,
        options: restoreWorkflowNodeOptionKeys(
          node.options,
          action.previousOptions,
          action.optionKeys,
        ),
      }))
    case "node-position":
      return updateWorkflowManifestNode(manifest, action.nodeId, (node) => ({
        ...node,
        position: { ...action.previousPosition },
      }))
  }
  return manifest
}

export function updateWorkflowManifestNode(
  manifest: WorkflowManifest,
  nodeId: string,
  updater: (node: WorkflowManifestNode) => WorkflowManifestNode,
): WorkflowManifest {
  let updated = false
  const nodes = manifest.nodes.map((node) => {
    if (node.id !== nodeId) {
      return node
    }
    updated = true
    return updater(node)
  })

  return updated ? { ...manifest, nodes } : manifest
}

export function restoreWorkflowNodeInputValues(
  options: Record<string, unknown>,
  previousInputValues: Record<string, unknown>,
): Record<string, unknown> {
  const nextOptions = { ...options }
  if (Object.keys(previousInputValues).length > 0) {
    nextOptions.inputValues = cloneWorkflowJsonValue(previousInputValues)
  } else {
    delete nextOptions.inputValues
  }
  return nextOptions
}

export function restoreWorkflowNodeOptionKeys(
  options: Record<string, unknown>,
  previousOptions: Record<string, unknown>,
  optionKeys: string[],
): Record<string, unknown> {
  const nextOptions = { ...options }
  for (const key of optionKeys) {
    if (Object.prototype.hasOwnProperty.call(previousOptions, key)) {
      nextOptions[key] = cloneWorkflowJsonValue(previousOptions[key])
    } else {
      delete nextOptions[key]
    }
  }
  return nextOptions
}

export function cloneWorkflowJsonValue<T>(value: T): T {
  return value && typeof value === "object" ? (JSON.parse(JSON.stringify(value)) as T) : value
}

export function getWorkflowNodeChangeDetails(
  previousNode: WorkflowManifestNode,
  nextNode: WorkflowManifestNode,
): WorkflowSaveChangeDetailSummary[] {
  const details: WorkflowSaveChangeDetailSummary[] = []

  if (previousNode.label !== nextNode.label) {
    details.push(
      createWorkflowSaveChangeDetail(
        `Label: "${previousNode.label}" -> "${nextNode.label}"`,
        {
          kind: "node-label",
          nodeId: nextNode.id,
          previousLabel: previousNode.label,
        },
        createWorkflowSaveChangeTextDiff(
          "Node label",
          "node-label.txt",
          previousNode.label,
          nextNode.label,
        ),
      ),
    )
  }
  if (previousNode.type !== nextNode.type) {
    details.push(
      createWorkflowSaveChangeDetail(
        `Type: ${formatWorkflowNodeType(previousNode)} -> ${formatWorkflowNodeType(nextNode)}`,
        {
          kind: "node-type",
          nodeId: nextNode.id,
          previousType: previousNode.type,
        },
        createWorkflowSaveChangeTextDiff(
          "Node type",
          "node-type.txt",
          formatWorkflowNodeType(previousNode),
          formatWorkflowNodeType(nextNode),
        ),
      ),
    )
  }

  const inputValueChange = getWorkflowInputValueChangeSummary(
    previousNode.options,
    nextNode.options,
  )
  if (inputValueChange) {
    details.push(
      createWorkflowSaveChangeDetail(
        inputValueChange,
        {
          kind: "node-input-values",
          nodeId: nextNode.id,
          previousInputValues: { ...asJsonRecord(previousNode.options.inputValues) },
        },
        createWorkflowSaveChangeJsonDiff(
          "Node input values",
          "input-values.json",
          asJsonRecord(previousNode.options.inputValues) ?? {},
          asJsonRecord(nextNode.options.inputValues) ?? {},
        ),
      ),
    )
  }

  const optionKeys = getRecordChangeKeys(previousNode.options, nextNode.options).filter(
    (key) => key !== "inputValues",
  )
  for (const optionKey of optionKeys) {
    details.push(
      createWorkflowSaveChangeDetail(
        `Option changed: ${formatWorkflowOptionKey(optionKey)}`,
        {
          kind: "node-options",
          nodeId: nextNode.id,
          previousOptions: previousNode.options,
          optionKeys: [optionKey],
        },
        createWorkflowSaveChangeJsonDiff(
          `Node option: ${formatWorkflowOptionKey(optionKey)}`,
          "node-option.json",
          getWorkflowNodeOptionDiffValue(previousNode.options, optionKey),
          getWorkflowNodeOptionDiffValue(nextNode.options, optionKey),
        ),
      ),
    )
  }

  if (hasWorkflowPositionChanged(previousNode.position, nextNode.position)) {
    details.push(
      createWorkflowSaveChangeDetail(
        `Position: ${formatWorkflowPosition(previousNode.position)} -> ${formatWorkflowPosition(nextNode.position)}`,
        {
          kind: "node-position",
          nodeId: nextNode.id,
          previousPosition: previousNode.position,
        },
        createWorkflowSaveChangeJsonDiff(
          "Node position",
          "node-position.json",
          previousNode.position,
          nextNode.position,
        ),
      ),
    )
  }

  return details.length > 0 ? details : [createWorkflowSaveChangeDetail("Node manifest changed")]
}

export function getWorkflowInputValueChangeSummary(
  previousOptions: Record<string, unknown>,
  nextOptions: Record<string, unknown>,
): string | null {
  const previousInputValues = asJsonRecord(previousOptions.inputValues) ?? {}
  const nextInputValues = asJsonRecord(nextOptions.inputValues) ?? {}
  if (formatJson(previousInputValues) === formatJson(nextInputValues)) {
    return null
  }

  const inputValueKeys = getRecordChangeKeys(previousInputValues, nextInputValues)
  return inputValueKeys.length > 0
    ? `Input values changed: ${formatCompactPlainList(inputValueKeys)}`
    : "Input values changed"
}

export function getWorkflowNodeOptionDetails(
  label: string,
  options: Record<string, unknown>,
): string[] {
  const optionKeys = Object.keys(options)
    .filter((key) => key !== "inputValues")
    .sort()
    .map(formatWorkflowOptionKey)
  const inputValues = asJsonRecord(options.inputValues)
  const details: string[] = []

  if (optionKeys.length > 0) {
    details.push(`${label}: ${formatCompactPlainList(optionKeys)}`)
  }
  if (inputValues && Object.keys(inputValues).length > 0) {
    details.push(`Input values: ${formatCompactPlainList(Object.keys(inputValues).sort())}`)
  }

  return details
}

export function getWorkflowEdgeChangeDetails(
  previousEdge: WorkflowManifestEdge,
  nextEdge: WorkflowManifestEdge,
  previousManifest: WorkflowManifest,
  nextManifest: WorkflowManifest,
): string[] {
  return [
    `Before: ${formatWorkflowConnection(previousEdge, previousManifest)}`,
    `After: ${formatWorkflowConnection(nextEdge, nextManifest)}`,
  ]
}

export function formatWorkflowConnection(
  edge: WorkflowManifestEdge,
  manifest: WorkflowManifest,
): string {
  return `${formatWorkflowConnectionEndpoint(
    manifest,
    edge.source,
    getNormalizedSourceHandle(edge.sourceHandle),
  )} -> ${formatWorkflowConnectionEndpoint(
    manifest,
    edge.target,
    getNormalizedTargetHandle(edge.targetHandle),
  )}`
}

export function formatWorkflowConnectionEndpoint(
  manifest: WorkflowManifest,
  nodeId: string,
  handle: string,
): string {
  const node = manifest.nodes.find((item) => item.id === nodeId)
  return `${node ? formatWorkflowNodeLabel(node) : nodeId}.${handle}`
}

export function getRecordChangeKeys(
  previousRecord: Record<string, unknown>,
  nextRecord: Record<string, unknown>,
): string[] {
  const keys = new Set([...Object.keys(previousRecord), ...Object.keys(nextRecord)])
  return Array.from(keys)
    .filter((key) => formatJson(previousRecord[key]) !== formatJson(nextRecord[key]))
    .sort()
}

export function formatWorkflowNodeLabel(node: WorkflowManifestNode): string {
  return node.label || node.id
}

export function getWorkflowNodeSaveChangeSubject(
  node: WorkflowManifestNode,
): WorkflowSaveChangeSubject {
  const definition = getWorkflowNodeDefinitionForNode(node)
  return {
    kind: "node",
    label: formatWorkflowNodeLabel(node),
    type: node.type,
    category: definition.category,
  }
}

export function formatWorkflowNodeType(node: WorkflowManifestNode): string {
  return getWorkflowNodeDefinitionForNode(node).label
}

export function formatWorkflowOptionKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .toLowerCase()
}

export function hasWorkflowPositionChanged(
  previousPosition: WorkflowManifestNode["position"],
  nextPosition: WorkflowManifestNode["position"],
): boolean {
  return previousPosition.x !== nextPosition.x || previousPosition.y !== nextPosition.y
}

export function formatWorkflowPosition(position: WorkflowManifestNode["position"]): string {
  return `x ${Math.round(position.x)}, y ${Math.round(position.y)}`
}

export function formatCompactPlainList(labels: string[], visibleCount = 4): string {
  const visibleLabels = labels.slice(0, visibleCount)
  const hiddenCount = labels.length - visibleLabels.length
  if (hiddenCount <= 0) {
    return visibleLabels.join(", ")
  }
  return `${visibleLabels.join(", ")} and ${hiddenCount} more`
}

export function pluralizeCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

export function hasWorkflowSlackTriggers(manifest: WorkflowManifest): boolean {
  return manifest.nodes.some((node) => node.type === "slack-trigger")
}

export function formatSlackRegistrationMatch(
  registration: WorkflowSlackTriggerRegistrationSummary,
): string {
  if (registration.surface === "command") {
    return registration.commandName ?? "slash command"
  }
  if (registration.surface === "interaction") {
    return formatUnknownStringList(registration.actionIds, "all actions")
  }

  const eventTypes = formatUnknownStringList(registration.eventTypes, "all events")
  const channelPattern = registration.channelNamePattern
    ? `channel ${registration.channelNamePattern}`
    : "any channel"
  const keywords = formatUnknownStringList(registration.keywordRules, "")
  return keywords
    ? `${eventTypes}; ${channelPattern}; ${keywords}`
    : `${eventTypes}; ${channelPattern}`
}

export function formatUnknownStringList(value: unknown, fallback: string): string {
  if (!Array.isArray(value)) {
    return fallback
  }
  const items = value.filter((item): item is string => typeof item === "string" && item.length > 0)
  return items.length > 0 ? items.join(", ") : fallback
}

export function getWorkflowVersionSaveLabel(workflow: WorkflowSummary | null): string {
  return workflow
    ? `v${workflow.manifestVersion} -> v${workflow.manifestVersion + 1}`
    : "Draft -> v1"
}

export function getWorkflowRuntimeVersionChangePreview(
  previousManifest: WorkflowManifest | null,
  nextManifest: WorkflowManifest,
): WorkflowRuntimeVersionChange | null {
  const previousVersion = previousManifest
    ? readWorkflowManifestVersion(previousManifest)
    : readWorkflowManifestVersion(nextManifest)
  const nextVersion = readWorkflowManifestVersion(nextManifest)
  return previousVersion < nextVersion
    ? { fromVersion: previousVersion, toVersion: nextVersion }
    : null
}

export function readWorkflowManifestVersion(manifest: WorkflowManifest): number {
  const candidate = (manifest as { version?: unknown }).version
  return typeof candidate === "number" && Number.isInteger(candidate) ? candidate : 0
}

export function formatWorkflowRuntimeVersionChange(change: WorkflowRuntimeVersionChange): string {
  return `v${change.fromVersion} -> v${change.toVersion}`
}
