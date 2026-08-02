import type {
  MessageSource,
  MessageStatus,
  PromptExecutionMode,
  SandboxStatus,
  SessionStatus,
} from "../types"
import type { AgentRuntime, SessionKind, SubagentMode } from "@c0-agent/shared"

export interface SessionRow {
  id: string
  session_name: string | null
  session_kind: SessionKind
  agent_runtime: AgentRuntime
  title: string | null
  repo_owner: string
  repo_name: string
  github_installation_id: number | null
  github_repo_id: number | null
  repo_default_branch: string | null
  branch_name: string | null
  tools_json: string
  custom_mcp_json: string
  secret_keys_json: string
  isolate_step_limit: number
  subagents: SubagentMode
  model: string
  reasoning_effort: string | null
  status: SessionStatus
  created_at: number
  updated_at: number
}

export interface ParticipantRow {
  id: string
  user_id: string
  github_login: string | null
  github_name: string | null
  github_email: string | null
  ws_auth_token: string | null
  ws_token_created_at: number | null
  role: "owner" | "member"
  joined_at: number
}

export interface MessageRow {
  id: string
  author_id: string
  content: string
  source: MessageSource
  model: string | null
  reasoning_effort: string | null
  execution_mode: PromptExecutionMode
  attachments: string | null
  callback_context: string | null
  status: MessageStatus
  error_message: string | null
  created_at: number
  started_at: number | null
  completed_at: number | null
}

export interface EventRow {
  id: string
  type: string
  data: string
  message_id: string | null
  created_at: number
}

export interface ArtifactRow {
  id: string
  type: string
  url: string | null
  metadata: string | null
  created_at: number
}

export interface SandboxRow {
  id: string
  sandbox_id: string | null
  auth_token: string | null
  opencode_session_id: string | null
  opencode_server_port: number | null
  opencode_config_signature: string | null
  status: SandboxStatus
  last_heartbeat: number | null
  last_activity: number | null
  last_spawn_error: string | null
  last_spawn_error_at: number | null
  created_at: number
}

export interface RuntimeLifecycleRow {
  id: string
  runtimeId: string | null
  authToken: string | null
  opencodeSessionId: string | null
  opencodeServerPort: number | null
  opencodeConfigSignature: string | null
  status: SandboxStatus
  lastHeartbeat: number | null
  lastActivity: number | null
  lastSpawnError: string | null
  lastSpawnErrorAt: number | null
  createdAt: number
}

export function toRuntimeLifecycleRow(row: SandboxRow): RuntimeLifecycleRow {
  return {
    id: row.id,
    runtimeId: row.sandbox_id,
    authToken: row.auth_token,
    opencodeSessionId: row.opencode_session_id,
    opencodeServerPort: row.opencode_server_port,
    opencodeConfigSignature: row.opencode_config_signature,
    status: row.status,
    lastHeartbeat: row.last_heartbeat,
    lastActivity: row.last_activity,
    lastSpawnError: row.last_spawn_error,
    lastSpawnErrorAt: row.last_spawn_error_at,
    createdAt: row.created_at,
  }
}

export interface SandboxActivityRow {
  id: string
  sandbox_id: string | null
  type: string
  summary: string
  status_from: string | null
  status_to: string | null
  keep_alive: number | null
  reason: string | null
  data: string
  created_at: number
}

export interface RuntimeActivityRow {
  id: string
  runtimeId: string | null
  type: string
  summary: string
  statusFrom: string | null
  statusTo: string | null
  keepAlive: boolean | null
  reason: string | null
  dataJson: string
  createdAt: number
}

export interface RuntimeActivityCreateInput {
  id?: string
  runtimeId?: string | null
  type: string
  summary: string
  statusFrom?: string | null
  statusTo?: string | null
  keepAlive?: boolean | null
  reason?: string | null
  data?: Record<string, unknown> | null
  createdAt?: number
}

export function toRuntimeActivityRow(row: SandboxActivityRow): RuntimeActivityRow {
  return {
    id: row.id,
    runtimeId: row.sandbox_id,
    type: row.type,
    summary: row.summary,
    statusFrom: row.status_from,
    statusTo: row.status_to,
    keepAlive: row.keep_alive == null ? null : row.keep_alive === 1,
    reason: row.reason,
    dataJson: row.data,
    createdAt: row.created_at,
  }
}

export function toSandboxActivityRow(row: RuntimeActivityRow): SandboxActivityRow {
  return {
    id: row.id,
    sandbox_id: row.runtimeId,
    type: row.type,
    summary: row.summary,
    status_from: row.statusFrom,
    status_to: row.statusTo,
    keep_alive: row.keepAlive == null ? null : row.keepAlive ? 1 : 0,
    reason: row.reason,
    data: row.dataJson,
    created_at: row.createdAt,
  }
}

export interface PromptDispatchResult {
  success: boolean
  error?: string
}
