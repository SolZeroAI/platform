import { AGENT_RUNTIMES, SubagentModeSchema } from "@solzero/shared"
import * as Schema from "effect/Schema"

function decodeSqlRows<A>(decode: (value: unknown) => A, rows: unknown[]): A[] {
  return rows.map((row) => decode(row))
}

export const SessionRowSchema = Schema.Struct({
  id: Schema.String,
  session_name: Schema.NullOr(Schema.String),
  session_kind: Schema.Literals(["isolate", "sandbox"]),
  agent_runtime: Schema.optional(Schema.NullOr(Schema.Literals(AGENT_RUNTIMES))),
  title: Schema.NullOr(Schema.String),
  repo_owner: Schema.String,
  repo_name: Schema.String,
  github_installation_id: Schema.NullOr(Schema.Number),
  github_repo_id: Schema.NullOr(Schema.Number),
  repo_default_branch: Schema.NullOr(Schema.String),
  branch_name: Schema.NullOr(Schema.String),
  tools_json: Schema.String,
  custom_mcp_json: Schema.String,
  secret_keys_json: Schema.String,
  isolate_step_limit: Schema.Number,
  subagents: SubagentModeSchema,
  model: Schema.String,
  reasoning_effort: Schema.NullOr(Schema.String),
  status: Schema.Literals(["created", "active", "completed", "archived"]),
  created_at: Schema.Number,
  updated_at: Schema.Number,
})

export const SandboxRowSchema = Schema.Struct({
  id: Schema.String,
  sandbox_id: Schema.NullOr(Schema.String),
  auth_token: Schema.NullOr(Schema.String),
  opencode_session_id: Schema.NullOr(Schema.String),
  opencode_server_port: Schema.NullOr(Schema.Number),
  opencode_config_signature: Schema.NullOr(Schema.String),
  status: Schema.Literals([
    "pending",
    "spawning",
    "connecting",
    "ready",
    "running",
    "stopped",
    "stale",
    "failed",
  ]),
  last_heartbeat: Schema.NullOr(Schema.Number),
  last_activity: Schema.NullOr(Schema.Number),
  last_spawn_error: Schema.NullOr(Schema.String),
  last_spawn_error_at: Schema.NullOr(Schema.Number),
  created_at: Schema.Number,
})

export const ParticipantRowSchema = Schema.Struct({
  id: Schema.String,
  user_id: Schema.String,
  github_login: Schema.NullOr(Schema.String),
  github_name: Schema.NullOr(Schema.String),
  github_email: Schema.NullOr(Schema.String),
  ws_auth_token: Schema.NullOr(Schema.String),
  ws_token_created_at: Schema.NullOr(Schema.Number),
  role: Schema.Literals(["owner", "member"]),
  joined_at: Schema.Number,
})

export const MessageRowSchema = Schema.Struct({
  id: Schema.String,
  author_id: Schema.String,
  content: Schema.String,
  source: Schema.Literals(["web", "slack", "extension", "github"]),
  model: Schema.NullOr(Schema.String),
  reasoning_effort: Schema.NullOr(Schema.String),
  execution_mode: Schema.Literals(["sync", "stream"]),
  attachments: Schema.NullOr(Schema.String),
  callback_context: Schema.NullOr(Schema.String),
  status: Schema.Literals(["pending", "processing", "completed", "failed"]),
  error_message: Schema.NullOr(Schema.String),
  created_at: Schema.Number,
  started_at: Schema.NullOr(Schema.Number),
  completed_at: Schema.NullOr(Schema.Number),
})

export const EventRowSchema = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  data: Schema.String,
  message_id: Schema.NullOr(Schema.String),
  created_at: Schema.Number,
})

export const SandboxActivityRowSchema = Schema.Struct({
  id: Schema.String,
  sandbox_id: Schema.NullOr(Schema.String),
  type: Schema.String,
  summary: Schema.String,
  status_from: Schema.NullOr(Schema.String),
  status_to: Schema.NullOr(Schema.String),
  keep_alive: Schema.NullOr(Schema.Number),
  reason: Schema.NullOr(Schema.String),
  data: Schema.String,
  created_at: Schema.Number,
})

export const ArtifactRowSchema = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  url: Schema.NullOr(Schema.String),
  metadata: Schema.NullOr(Schema.String),
  created_at: Schema.Number,
})

export const RuntimeActivityCreatedAtSchema = Schema.Struct({
  created_at: Schema.Number,
})

export const SqlChangeCountSchema = Schema.Struct({
  count: Schema.optional(Schema.Union([Schema.Number, Schema.String])),
})

export const WsClientIdSchema = Schema.Struct({
  ws_id: Schema.String,
})

export const WsClientMappingSchema = Schema.Struct({
  participant_id: Schema.String,
  client_id: Schema.String,
  user_id: Schema.String,
  github_name: Schema.NullOr(Schema.String),
  github_login: Schema.NullOr(Schema.String),
})

export const ParticipantTokenStatsSchema = Schema.Struct({
  participant_count: Schema.optional(Schema.Number),
  active_token_count: Schema.optional(Schema.Number),
  stored_token_count: Schema.optional(Schema.Number),
  latest_token_created_at: Schema.optional(Schema.NullOr(Schema.Number)),
})

const decodeSessionRow = Schema.decodeUnknownSync(SessionRowSchema, { onExcessProperty: "ignore" })
const decodeSandboxRow = Schema.decodeUnknownSync(SandboxRowSchema, { onExcessProperty: "ignore" })
const decodeParticipantRow = Schema.decodeUnknownSync(ParticipantRowSchema, {
  onExcessProperty: "ignore",
})
const decodeMessageRow = Schema.decodeUnknownSync(MessageRowSchema, { onExcessProperty: "ignore" })
const decodeEventRow = Schema.decodeUnknownSync(EventRowSchema, { onExcessProperty: "ignore" })
const decodeArtifactRow = Schema.decodeUnknownSync(ArtifactRowSchema, {
  onExcessProperty: "ignore",
})
const decodeSandboxActivityRow = Schema.decodeUnknownSync(SandboxActivityRowSchema, {
  onExcessProperty: "ignore",
})
const decodeRuntimeActivityCreatedAtRow = Schema.decodeUnknownSync(RuntimeActivityCreatedAtSchema, {
  onExcessProperty: "ignore",
})

export const decodeSessionRows = (rows: unknown[]) => decodeSqlRows(decodeSessionRow, rows)
export const decodeSandboxRows = (rows: unknown[]) => decodeSqlRows(decodeSandboxRow, rows)
export const decodeParticipantRows = (rows: unknown[]) => decodeSqlRows(decodeParticipantRow, rows)
export const decodeMessageRows = (rows: unknown[]) => decodeSqlRows(decodeMessageRow, rows)
export const decodeEventRows = (rows: unknown[]) => decodeSqlRows(decodeEventRow, rows)
export const decodeArtifactRows = (rows: unknown[]) => decodeSqlRows(decodeArtifactRow, rows)
export const decodeSandboxActivityRows = (rows: unknown[]) =>
  decodeSqlRows(decodeSandboxActivityRow, rows)
export const decodeRuntimeActivityCreatedAtRows = (rows: unknown[]) =>
  decodeSqlRows(decodeRuntimeActivityCreatedAtRow, rows)
export const decodeSqlChangeCount = Schema.decodeUnknownSync(SqlChangeCountSchema, {
  onExcessProperty: "ignore",
})
const decodeWsClientIdRow = Schema.decodeUnknownSync(WsClientIdSchema, {
  onExcessProperty: "ignore",
})
const decodeWsClientMappingRow = Schema.decodeUnknownSync(WsClientMappingSchema, {
  onExcessProperty: "ignore",
})
export const decodeWsClientIdRows = (rows: unknown[]) => decodeSqlRows(decodeWsClientIdRow, rows)
export const decodeWsClientMappingRows = (rows: unknown[]) =>
  decodeSqlRows(decodeWsClientMappingRow, rows)
export const decodeParticipantTokenStats = Schema.decodeUnknownSync(ParticipantTokenStatsSchema, {
  onExcessProperty: "ignore",
})
