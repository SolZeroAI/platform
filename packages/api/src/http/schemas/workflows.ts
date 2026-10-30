import { Schema } from "effect"
import { HttpApiSchema } from "effect/http-api"
import { JsonRecord, JsonValue } from "./common"

export const WorkflowIdParams = {
  id: Schema.String,
}

export type WorkflowIdParams = { id: string }

export const WorkflowRunParams = {
  id: Schema.String,
  runId: Schema.String,
}

export type WorkflowRunParams = { id: string; runId: string }

export const WorkflowRunArtifactParams = {
  id: Schema.String,
  runId: Schema.String,
  nodeId: Schema.String,
}

export type WorkflowRunArtifactParams = { id: string; runId: string; nodeId: string }

export const WorkflowRunsStreamQuery = {
  runId: Schema.optionalKey(Schema.String),
}

export type WorkflowRunsStreamQuery = {
  runId?: string
}

export const WorkflowRunListQuery = {
  limit: Schema.optionalKey(Schema.String),
  offset: Schema.optionalKey(Schema.String),
  q: Schema.optionalKey(Schema.String),
  sortBy: Schema.optionalKey(Schema.String),
  sortDir: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(Schema.String),
  triggerKind: Schema.optionalKey(Schema.String),
}

export type WorkflowRunListQuery = {
  limit?: string
  offset?: string
  q?: string
  sortBy?: string
  sortDir?: string
  status?: string
  triggerKind?: string
}

export const WorkflowBuilderDraftQuery = {
  sessionId: Schema.String,
}

export type WorkflowBuilderDraftQuery = {
  sessionId: string
}

export class WorkflowCatalogResponse extends Schema.Class<WorkflowCatalogResponse>(
  "WorkflowCatalogResponse",
)({
  nodes: Schema.Array(JsonRecord),
}) {}

export const WorkflowListQuery = {
  limit: Schema.optionalKey(Schema.String),
  offset: Schema.optionalKey(Schema.String),
  q: Schema.optionalKey(Schema.String),
  sortBy: Schema.optionalKey(Schema.String),
  sortDir: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(Schema.String),
}

export type WorkflowListQuery = {
  limit?: string
  offset?: string
  q?: string
  sortBy?: string
  sortDir?: string
  status?: string
}

export const WorkflowStatus = Schema.Literals(["active", "disabled", "archived"])

/**
 * One workflow, as the workflow routes return it. `manifest` is the stored manifest JSON; the
 * builder migrates manifests from older versions, so the contract does not pin their shape.
 */
export const WorkflowSummary = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  name: Schema.String,
  status: WorkflowStatus,
  manifestVersion: Schema.Number,
  manifestKey: Schema.String,
  codeKey: Schema.String,
  webhookId: Schema.String,
  webhookPath: Schema.String,
  webhookUrl: Schema.NullOr(Schema.String),
  manifest: Schema.optionalKey(JsonRecord),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})

export type WorkflowSummary = typeof WorkflowSummary.Type

export const WorkflowRun = Schema.Struct({
  id: Schema.String,
  workflowId: Schema.String,
  workflowVersion: Schema.Number,
  workflowInstanceId: Schema.NullOr(Schema.String),
  userId: Schema.String,
  triggerKind: Schema.Literals(["manual", "webhook", "datetime", "cron", "slack"]),
  triggerNodeId: Schema.NullOr(Schema.String),
  status: Schema.Literals(["queued", "running", "completed", "failed"]),
  input: JsonRecord,
  output: Schema.NullOr(JsonRecord),
  error: Schema.NullOr(Schema.String),
  startedAt: Schema.Number,
  completedAt: Schema.NullOr(Schema.Number),
  updatedAt: Schema.Number,
})

export type WorkflowRun = typeof WorkflowRun.Type

export const WorkflowRunEvent = Schema.Struct({
  id: Schema.String,
  workflowId: Schema.String,
  runId: Schema.String,
  sequence: Schema.Number,
  nodeId: Schema.NullOr(Schema.String),
  eventType: Schema.String,
  level: Schema.Literals(["info", "warn", "error"]),
  message: Schema.String,
  data: JsonRecord,
  createdAt: Schema.Number,
})

export type WorkflowRunEvent = typeof WorkflowRunEvent.Type

export class WorkflowListResponse extends Schema.Class<WorkflowListResponse>(
  "WorkflowListResponse",
)({
  workflows: Schema.Array(WorkflowSummary),
  total: Schema.Number,
  limit: Schema.Number,
  offset: Schema.Number,
  hasMore: Schema.Boolean,
}) {}

export const UpsertWorkflowPayload = Schema.Struct({
  name: Schema.String,
  manifest: Schema.Unknown,
})

export type UpsertWorkflowPayload = typeof UpsertWorkflowPayload.Type

export const UpdateWorkflowNamePayload = Schema.Struct({
  name: Schema.String,
})

export type UpdateWorkflowNamePayload = typeof UpdateWorkflowNamePayload.Type

export const RunWorkflowPayload = Schema.Struct({
  trigger: Schema.optionalKey(Schema.Unknown),
})

export type RunWorkflowPayload = typeof RunWorkflowPayload.Type

export const WorkflowApprovalPayload = Schema.Struct({
  nodeId: Schema.String,
  approved: Schema.Boolean,
  comment: Schema.optionalKey(Schema.String),
})

export type WorkflowApprovalPayload = typeof WorkflowApprovalPayload.Type

export const WorkflowSlackAppCredentialsPayload = Schema.Struct({
  signingSecret: Schema.optionalKey(Schema.String),
  botToken: Schema.optionalKey(Schema.String),
})

export type WorkflowSlackAppCredentialsPayload = typeof WorkflowSlackAppCredentialsPayload.Type

export class WorkflowResponse extends Schema.Class<WorkflowResponse>("WorkflowResponse")({
  workflow: WorkflowSummary,
}) {}

export const WorkflowManifestMigrationStep = Schema.Struct({
  fromVersion: Schema.Number,
  toVersion: Schema.Number,
  description: Schema.String,
})

/** A created or updated workflow, with the manifest migration the save applied. */
export class WorkflowSaveResponse extends Schema.Class<WorkflowSaveResponse>(
  "WorkflowSaveResponse",
)({
  workflow: WorkflowSummary,
  manifestMigration: Schema.Struct({
    fromVersion: Schema.Number,
    toVersion: Schema.Number,
    steps: Schema.Array(WorkflowManifestMigrationStep),
  }),
}) {}

export const CreatedWorkflowResponse = WorkflowSaveResponse.pipe(HttpApiSchema.status(201))

export class WorkflowRunResponse extends Schema.Class<WorkflowRunResponse>("WorkflowRunResponse")({
  run: WorkflowRun,
}) {}

export const CreatedWorkflowRunResponse = WorkflowRunResponse.pipe(HttpApiSchema.status(201))

export class DeletedWorkflowRunResponse extends Schema.Class<DeletedWorkflowRunResponse>(
  "DeletedWorkflowRunResponse",
)({
  status: Schema.String,
  workflowId: Schema.String,
  runId: Schema.String,
}) {}

export class WorkflowRunsResponse extends Schema.Class<WorkflowRunsResponse>(
  "WorkflowRunsResponse",
)({
  runs: Schema.Array(WorkflowRun),
  total: Schema.Number,
  totalRuns: Schema.Number,
  errorsLast24Hours: Schema.Number,
  limit: Schema.Number,
  offset: Schema.Number,
  hasMore: Schema.Boolean,
}) {}

export class WorkflowRunEventsResponse extends Schema.Class<WorkflowRunEventsResponse>(
  "WorkflowRunEventsResponse",
)({
  events: Schema.Array(WorkflowRunEvent),
}) {}

export class WorkflowRunArtifactContentResponse extends Schema.Class<WorkflowRunArtifactContentResponse>(
  "WorkflowRunArtifactContentResponse",
)({
  artifact: Schema.Struct({
    nodeId: Schema.String,
    nodeType: Schema.Literals(["r2-put-object", "kv-put"]),
    storageType: Schema.Literals(["r2", "kv"]),
    binding: Schema.String,
    key: Schema.String,
    contentType: Schema.NullOr(Schema.String),
    etag: Schema.NullOr(Schema.String),
    content: JsonValue,
    text: Schema.String,
  }),
}) {}

export class WorkflowApprovalResponse extends Schema.Class<WorkflowApprovalResponse>(
  "WorkflowApprovalResponse",
)({
  status: Schema.String,
  workflowId: Schema.String,
  runId: Schema.String,
  nodeId: Schema.String,
  approved: Schema.Boolean,
}) {}

export class WorkflowBuilderDraftResponse extends Schema.Class<WorkflowBuilderDraftResponse>(
  "WorkflowBuilderDraftResponse",
)({
  draft: Schema.NullOr(JsonRecord),
}) {}

export class WorkflowSlackAppResponse extends Schema.Class<WorkflowSlackAppResponse>(
  "WorkflowSlackAppResponse",
)({
  slackApp: JsonRecord,
}) {}

export class DeletedWorkflowResponse extends Schema.Class<DeletedWorkflowResponse>(
  "DeletedWorkflowResponse",
)({
  status: Schema.String,
  workflowId: Schema.String,
}) {}

export class WorkflowExportResponse extends Schema.Class<WorkflowExportResponse>(
  "WorkflowExportResponse",
)({
  yaml: Schema.String,
}) {}
