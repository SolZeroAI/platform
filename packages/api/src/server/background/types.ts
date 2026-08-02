import type { ApiEnv } from "infra/types/env"
import type {
  AgentRuntime,
  OpenCodeMcpServers,
  SessionKind,
  SessionCallbackContext,
  SessionToolSpec,
  SubagentMode,
  SubagentRunSummary,
} from "@c0-agent/shared"

export type {
  ClientMessage,
  ParticipantPresence,
  RuntimeSessionEvent,
  SandboxEvent,
  ServerMessage,
  SessionEvent,
  SessionState,
} from "@c0-agent/shared"

export interface AiSearchResultContentItem {
  id?: string
  type?: string
  text?: string
}

export interface AiSearchResultItem {
  file_id?: string
  filename?: string
  score?: number
  content?: AiSearchResultContentItem[]
}

export interface AiSearchSearchResponse {
  data?: AiSearchResultItem[]
}

export interface AiSearchAiSearchResponse {
  response?: string
  data?: AiSearchResultItem[]
}

export type Env = ApiEnv

export type SessionStatus = "created" | "active" | "completed" | "archived"
export type SandboxStatus =
  | "pending"
  | "spawning"
  | "connecting"
  | "ready"
  | "running"
  | "stopped"
  | "stale"
  | "failed"

export type MessageStatus = "pending" | "processing" | "completed" | "failed"
export type MessageSource = "web" | "slack" | "extension" | "github"
export type PromptExecutionMode = "sync" | "stream"

export interface Attachment {
  type: "file" | "image" | "url"
  name: string
  url?: string
  content?: string
  mimeType?: string
}

export interface ClientInfo {
  participantId: string
  userId: string
  name: string
  status: "active" | "idle"
  lastSeen: number
  clientId: string
  ws: WebSocket
  lastFetchHistoryAt?: number
}

export interface CreateSessionRequest {
  sessionKind?: SessionKind
  agentRuntime?: AgentRuntime
  repoOwner?: string
  repoName?: string
  tools?: SessionToolSpec[]
  customMcpServers?: OpenCodeMcpServers
  subagents?: SubagentMode
  title?: string
  model?: string
  reasoningEffort?: string
  userId?: string
  githubLogin?: string
  githubName?: string
  githubEmail?: string
  incognito?: boolean
}

export interface CreateSessionResponse {
  sessionId: string
  sessionKind: SessionKind
  agentRuntime: AgentRuntime
  status: SessionStatus
}

export interface RunSessionPromptRequest extends CreateSessionRequest {
  sessionId?: string
  content: string
  source?: MessageSource
  attachments?: Array<{ type: string; name: string; url?: string }>
  callbackContext?: SessionCallbackContext
}

export interface RunSessionPromptResponse {
  sessionId: string
  sessionKind: SessionKind
  agentRuntime: AgentRuntime
  createdSession: boolean
  messageId: string
  status: MessageStatus
  output: string | null
  subagentRuns?: SubagentRunSummary[]
  error?: string
}
