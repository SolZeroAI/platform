import type { OpenCodeMcpServers } from "../provider-config"
import type { SessionToolSpec } from "../session-tools"
import type { SubagentMode } from "../subagents"
import type { WorkflowNodeType } from "../workflow-nodes"

export const WORKFLOW_MANIFEST_VERSION = 4 as const
export const WORKFLOW_SUBAGENTS_MANIFEST_VERSION = 4 as const

export interface WorkflowNodeOptions
  extends
    WorkflowSessionNodeOptions,
    WorkflowJavaScriptNodeOptions,
    WorkflowIfElseNodeOptions,
    WorkflowJsonObjectOptions,
    WorkflowDateTimeTriggerOptions,
    WorkflowCronTriggerOptions,
    WorkflowHttpRequestOptions,
    WorkflowR2PutObjectOptions,
    WorkflowR2GetObjectOptions,
    WorkflowKvPutOptions,
    WorkflowKvGetOptions,
    WorkflowGetSecretOptions,
    WorkflowUserApprovalOptions,
    WorkflowSlackNotificationOptions,
    WorkflowSlackTriggerOptions,
    WorkflowSlackSendMessageOptions,
    WorkflowSlackJoinChannelOptions,
    WorkflowSlackFetchThreadOptions,
    WorkflowSlackAddReactionOptions,
    WorkflowSlackRemoveReactionOptions,
    WorkflowEmailNotificationOptions {
  title?: string
  encoding?: string
  inputValues?: Record<string, string>
}

export interface WorkflowManifestNode {
  id: string
  type: WorkflowNodeType
  label: string
  position: {
    x: number
    y: number
  }
  options: WorkflowNodeOptions
}

export interface WorkflowManifestEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

export interface WorkflowManifest {
  version: typeof WORKFLOW_MANIFEST_VERSION
  name: string
  nodes: WorkflowManifestNode[]
  edges: WorkflowManifestEdge[]
}

export interface WorkflowExportDocument {
  kind: "s0.workflow"
  exportVersion: 1
  name: string
  manifest: WorkflowManifest
  executionOrder: string[]
  metadata: {
    exportedAt: string
    sourceManifestVersion: number
  }
}

export interface WorkflowDraftValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  executionOrder: string[]
  manifest?: WorkflowManifest
}

export type WorkflowTemplateComplexity = "simple" | "moderate" | "complex"

export interface WorkflowTemplate {
  id: string
  name: string
  description: string
  complexity: WorkflowTemplateComplexity
  tags?: string[]
  manifest: WorkflowManifest
}

export interface WorkflowSessionNodeOptions {
  prompt?: string
  model?: string
  reasoningEffort?: string
  sessionKey?: string
  cacheKey?: string
  cacheTtlSeconds?: number | string
  incognito?: boolean
  subagents?: SubagentMode
  tools?: SessionToolSpec[]
  customMcpServers?: OpenCodeMcpServers
  secretKeys?: string[]
  repoOwner?: string
  repoName?: string
}

export interface WorkflowJavaScriptNodeOptions {
  code?: string
}

export interface WorkflowIfElseNodeOptions {
  conditionExpression?: string
}

export interface WorkflowJsonObjectOptions {
  fields?: string[]
}

export interface WorkflowDateTimeTriggerOptions {
  scheduledAt?: string
}

export interface WorkflowCronTriggerOptions {
  cron?: string
}

export interface WorkflowHttpRequestOptions {
  method?: string
  url?: string
  headers?: Record<string, string>
  body?: string
  responseType?: "auto" | "json" | "text"
  timeoutMs?: number
  failOnHttpError?: boolean
}

export interface WorkflowR2PutObjectOptions {
  bucket?: string
  key?: string
  contentType?: string
}

export interface WorkflowKvPutOptions {
  namespace?: string
  key?: string
  expirationTtl?: number | string
}

export interface WorkflowUserApprovalOptions {
  message?: string
  timeout?: string
}

export interface WorkflowSlackNotificationOptions {
  channel?: string
  message?: string
  threadTs?: string
}

export type WorkflowSlackTriggerSurface = "event" | "command" | "interaction"

export interface WorkflowSlackTriggerOptions {
  surface?: WorkflowSlackTriggerSurface
  eventTypes?: string[]
  channelNamePattern?: string
  keywordRules?: string[]
  cooldownSeconds?: number
  dedupeWindowSeconds?: number
  command?: string
  commandDescription?: string
  actionIds?: string[]
}

export interface WorkflowSlackBlock {
  type: string
}

export interface WorkflowSlackSendMessageOptions {
  channel?: string
  text?: string
  threadTs?: string
  blocks?: string | WorkflowSlackBlock[]
}

export interface WorkflowSlackJoinChannelOptions {
  channel?: string
}

export interface WorkflowSlackFetchThreadOptions {
  channel?: string
  threadTs?: string
  limit?: number
}

export interface WorkflowSlackAddReactionOptions {
  channel?: string
  timestamp?: string
  name?: string
}

export interface WorkflowSlackRemoveReactionOptions {
  channel?: string
  timestamp?: string
  name?: string
}

export interface WorkflowEmailNotificationOptions {
  to?: string
  from?: string
  subject?: string
  body?: string
}

export interface WorkflowR2GetObjectOptions {
  bucket?: string
  key?: string
  responseType?: "auto" | "json" | "text"
}

export interface WorkflowKvGetOptions {
  namespace?: string
  key?: string
  responseType?: "auto" | "json" | "text"
}

export interface WorkflowGetSecretOptions {
  key?: string
}
