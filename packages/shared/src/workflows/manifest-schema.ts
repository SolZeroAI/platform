import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { OpenCodeMcpServersSchema } from "../provider-config"
import { AI_SEARCH_SESSION_TOOL_KIND, MCPCF_SESSION_TOOL_KIND } from "../session-tools"
import { SubagentModeSchema } from "../subagents"
import { WORKFLOW_NODE_TYPES } from "../workflow-nodes/definitions"
import {
  WORKFLOW_MANIFEST_VERSION,
  type WorkflowManifest,
  type WorkflowNodeOptions,
} from "./manifest-types"

const WorkflowNodeTypeSchema = Schema.Literals(WORKFLOW_NODE_TYPES)

const GitHubRepoSessionToolSchema = Schema.Struct({
  kind: Schema.Literal("github_repo"),
  repoOwner: Schema.String,
  repoName: Schema.String,
})

const AiSearchSessionToolSchema = Schema.Struct({
  kind: Schema.Literal(AI_SEARCH_SESSION_TOOL_KIND),
  sourceId: Schema.String,
})

const WorkflowBuilderSessionToolSchema = Schema.Struct({
  kind: Schema.Literal("workflow_builder"),
})

const McpcfSessionToolSchema = Schema.Struct({
  kind: Schema.Literal(MCPCF_SESSION_TOOL_KIND),
  serverId: Schema.String,
})

export const SessionToolSpecSchema = Schema.Union([
  GitHubRepoSessionToolSchema,
  AiSearchSessionToolSchema,
  WorkflowBuilderSessionToolSchema,
  McpcfSessionToolSchema,
])

const SlackBlockSchema = Schema.Struct({
  type: Schema.String,
})

export const WorkflowNodeOptionsSchema = Schema.Struct({
  title: Schema.optional(Schema.String),
  encoding: Schema.optional(Schema.String),
  inputValues: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  prompt: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  reasoningEffort: Schema.optional(Schema.String),
  sessionKey: Schema.optional(Schema.String),
  cacheKey: Schema.optional(Schema.String),
  cacheTtlSeconds: Schema.optional(Schema.Union([Schema.Number, Schema.String])),
  incognito: Schema.optional(Schema.Boolean),
  subagents: Schema.optional(SubagentModeSchema),
  tools: Schema.optional(Schema.mutable(Schema.Array(SessionToolSpecSchema))),
  customMcpServers: Schema.optional(OpenCodeMcpServersSchema),
  secretKeys: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  repoOwner: Schema.optional(Schema.String),
  repoName: Schema.optional(Schema.String),
  code: Schema.optional(Schema.String),
  conditionExpression: Schema.optional(Schema.String),
  fields: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  scheduledAt: Schema.optional(Schema.String),
  cron: Schema.optional(Schema.String),
  method: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  body: Schema.optional(Schema.String),
  responseType: Schema.optional(Schema.Literals(["auto", "json", "text"])),
  timeoutMs: Schema.optional(Schema.Number),
  failOnHttpError: Schema.optional(Schema.Boolean),
  bucket: Schema.optional(Schema.String),
  key: Schema.optional(Schema.String),
  contentType: Schema.optional(Schema.String),
  namespace: Schema.optional(Schema.String),
  expirationTtl: Schema.optional(Schema.Union([Schema.Number, Schema.String])),
  message: Schema.optional(Schema.String),
  timeout: Schema.optional(Schema.String),
  channel: Schema.optional(Schema.String),
  threadTs: Schema.optional(Schema.String),
  surface: Schema.optional(Schema.Literals(["event", "command", "interaction"])),
  eventTypes: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  channelNamePattern: Schema.optional(Schema.String),
  keywordRules: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  cooldownSeconds: Schema.optional(Schema.Number),
  dedupeWindowSeconds: Schema.optional(Schema.Number),
  command: Schema.optional(Schema.String),
  commandDescription: Schema.optional(Schema.String),
  actionIds: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  text: Schema.optional(Schema.String),
  blocks: Schema.optional(
    Schema.Union([Schema.String, Schema.mutable(Schema.Array(SlackBlockSchema))]),
  ),
  timestamp: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  to: Schema.optional(Schema.String),
  from: Schema.optional(Schema.String),
  subject: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Number),
})

const WorkflowManifestDraftNodeSchema = Schema.Struct({
  id: Schema.optional(Schema.String),
  type: WorkflowNodeTypeSchema,
  label: Schema.optional(Schema.String),
  position: Schema.optional(
    Schema.Struct({
      x: Schema.optional(Schema.Number),
      y: Schema.optional(Schema.Number),
    }),
  ),
  options: Schema.optional(WorkflowNodeOptionsSchema),
})

const WorkflowManifestDraftEdgeSchema = Schema.Struct({
  id: Schema.optional(Schema.String),
  source: Schema.String,
  target: Schema.String,
  sourceHandle: Schema.optional(Schema.NullOr(Schema.String)),
  targetHandle: Schema.optional(Schema.NullOr(Schema.String)),
})

export const WorkflowManifestDraftSchema = Schema.Struct({
  version: Schema.optional(Schema.Number),
  name: Schema.optional(Schema.String),
  nodes: Schema.optional(Schema.Array(WorkflowManifestDraftNodeSchema)),
  edges: Schema.optional(Schema.Array(WorkflowManifestDraftEdgeSchema)),
})

const WorkflowManifestNodeSchema = Schema.Struct({
  id: Schema.String,
  type: WorkflowNodeTypeSchema,
  label: Schema.String,
  position: Schema.Struct({
    x: Schema.Number,
    y: Schema.Number,
  }),
  options: WorkflowNodeOptionsSchema,
})

const WorkflowManifestEdgeSchema = Schema.Struct({
  id: Schema.String,
  source: Schema.String,
  target: Schema.String,
  sourceHandle: Schema.optional(Schema.NullOr(Schema.String)),
  targetHandle: Schema.optional(Schema.NullOr(Schema.String)),
})

export const WorkflowManifestSchema = Schema.Struct({
  version: Schema.Literal(WORKFLOW_MANIFEST_VERSION),
  name: Schema.String,
  nodes: Schema.mutable(Schema.Array(WorkflowManifestNodeSchema)),
  edges: Schema.mutable(Schema.Array(WorkflowManifestEdgeSchema)),
})

export type WorkflowManifestDraft = typeof WorkflowManifestDraftSchema.Type

const decodeOptions = Schema.decodeUnknownOption(WorkflowNodeOptionsSchema, {
  onExcessProperty: "ignore",
})
const decodeDraft = Schema.decodeUnknownOption(WorkflowManifestDraftSchema, {
  onExcessProperty: "ignore",
})
const decodeManifest = Schema.decodeUnknownOption(WorkflowManifestSchema, {
  onExcessProperty: "ignore",
})

function toWorkflowNodeOptions(
  options: typeof WorkflowNodeOptionsSchema.Type,
): WorkflowNodeOptions {
  return {
    ...options,
    ...Option.match(Option.fromNullishOr(options.inputValues), {
      onNone: () => ({}),
      onSome: (inputValues) => ({ inputValues: { ...inputValues } }),
    }),
    ...Option.match(Option.fromNullishOr(options.headers), {
      onNone: () => ({}),
      onSome: (headers) => ({ headers: { ...headers } }),
    }),
  }
}

function toWorkflowManifest(manifest: typeof WorkflowManifestSchema.Type): WorkflowManifest {
  return {
    ...manifest,
    nodes: manifest.nodes.map((node) => ({
      ...node,
      options: toWorkflowNodeOptions(node.options),
    })),
    edges: [...manifest.edges],
  }
}

export function parseWorkflowNodeOptions(value: unknown): WorkflowNodeOptions {
  return Option.match(decodeOptions(value), {
    onNone: () => ({}),
    onSome: (options) => toWorkflowNodeOptions(options),
  })
}

export function parseWorkflowManifestDraft(value: unknown): Option.Option<WorkflowManifestDraft> {
  return decodeDraft(value)
}

export function parseWorkflowManifest(value: unknown): Option.Option<WorkflowManifest> {
  return Option.map(decodeManifest(value), toWorkflowManifest)
}
