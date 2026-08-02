import { Schema } from "effect"
import { HttpApiSchema } from "effect/unstable/httpapi"
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

export class WorkflowListResponse extends Schema.Class<WorkflowListResponse>(
  "WorkflowListResponse",
)({
  workflows: Schema.Array(JsonRecord),
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
  workflow: JsonRecord,
}) {}

export const CreatedWorkflowResponse = WorkflowResponse.pipe(HttpApiSchema.status(201))

export class WorkflowRunResponse extends Schema.Class<WorkflowRunResponse>("WorkflowRunResponse")({
  run: JsonRecord,
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
  runs: Schema.Array(JsonRecord),
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
  events: Schema.Array(JsonRecord),
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
