/**
 * Shared type definitions used across packages.
 */

import type { AgentRuntime, SessionKind } from "./agent-runtime"
import type { OpenCodeMcpServers } from "./provider-config"
import type { SubagentRunSummary } from "./session-events"
import type { SessionToolSpec } from "./session-tools"
import type { SubagentMode } from "./subagents"

// Session states
export type SessionStatus = "created" | "active" | "completed" | "archived"
export type SandboxStatus =
  | "pending"
  | "spawning"
  | "warming"
  | "syncing"
  | "connecting"
  | "ready"
  | "running"
  | "stopped"
  | "stale"
  | "failed"
export type GitSyncStatus = "pending" | "in_progress" | "completed" | "failed"
export type MessageStatus = "pending" | "processing" | "completed" | "failed"
export type MessageSource = "web" | "slack" | "extension" | "github"
export type SessionInitiationSource = "web" | "slack" | "api"
export type ArtifactType = "pr" | "screenshot" | "preview" | "branch"
export type EventType =
  | "tool_call"
  | "tool_result"
  | "token"
  | "reasoning"
  | "error"
  | "git_sync"
  | "step_limit_warning"
  | "subagent_event"

export interface SessionRuntimeCapabilities {
  agentRuntime: AgentRuntime
  supportsWorkspace: boolean
  supportsGit: boolean
  supportsDocs: boolean
  supportsRepoWorkspace: boolean
}

// User info for commit attribution
export interface GitUser {
  name: string
  email: string
}

// Participant in a session
export interface SessionParticipant {
  id: string
  userId: string
  githubLogin: string | null
  githubName: string | null
  githubEmail: string | null
  role: "owner" | "member"
}

// Session state
export interface Session {
  id: string
  sessionKind: SessionKind
  agentRuntime: AgentRuntime
  title: string | null
  repoOwner: string
  repoName: string
  githubInstallationId?: number | null
  githubRepoId?: number | null
  tools?: SessionToolSpec[]
  customMcpServers?: OpenCodeMcpServers
  secretKeys?: string[]
  isolateStepLimit?: number
  subagents?: SubagentMode
  repoDefaultBranch: string
  branchName: string | null
  baseSha: string | null
  currentSha: string | null
  opencodeSessionId: string | null
  incognito?: boolean
  status: SessionStatus
  createdAt: number
  updatedAt: number
}

// Message in a session
export interface SessionMessage {
  id: string
  authorId: string
  content: string
  source: MessageSource
  attachments: Attachment[] | null
  status: MessageStatus
  createdAt: number
  startedAt: number | null
  completedAt: number | null
}

// Attachment to a message
export interface Attachment {
  type: "file" | "image" | "url"
  name: string
  url?: string
  content?: string
  mimeType?: string
}

// Agent event
export interface AgentEvent {
  id: string
  type: EventType
  data: Record<string, unknown>
  messageId: string | null
  createdAt: number
}

// Artifact created by session
export interface SessionEventMetadata {
  terminal?: boolean
  serverName?: string
}

export interface SessionArtifactMetadata {
  mode?: "manual_pr"
  head?: string
  base?: string
  createPrUrl?: string
  provider?: string
  prNumber?: number
}

export interface SessionArtifact {
  id: string
  type: ArtifactType
  url: string | null
  metadata: SessionArtifactMetadata | null
  createdAt: number
}

/**
 * Metadata stored on branch artifacts when PR creation falls back to manual flow.
 */
export interface ManualPullRequestArtifactMetadata {
  mode: "manual_pr"
  head: string
  base: string
  createPrUrl: string
  provider?: string
}

// Pull request info
export interface PullRequest {
  number: number
  title: string
  body: string
  url: string
  state: "open" | "closed" | "merged"
  headRef: string
  baseRef: string
  createdAt: string
  updatedAt: string
}

export const MCP_DISCOVERY_ERROR_REASONS = [
  "oauth_reconnect_required",
  "server_unavailable",
  "no_callable_tools",
] as const

export type McpDiscoveryErrorReason = (typeof MCP_DISCOVERY_ERROR_REASONS)[number]

const MCP_DISCOVERY_ERROR_REASON_VALUES: readonly string[] = MCP_DISCOVERY_ERROR_REASONS

export function isMcpDiscoveryErrorReason(value: unknown): value is McpDiscoveryErrorReason {
  return typeof value === "string" && MCP_DISCOVERY_ERROR_REASON_VALUES.includes(value)
}

export interface McpDiscoveryErrorLike {
  serverName?: string | null
  error?: string | null
  discoveryReason?: McpDiscoveryErrorReason | null
  metadata?: SessionEventMetadata | null
}

function getMcpDiscoveryServerName(event: McpDiscoveryErrorLike): string {
  return (
    event.serverName ??
    (typeof event.metadata?.serverName === "string" ? event.metadata.serverName : "")
  )
}

export function isOktaReconnectMcpDiscoveryError(event: McpDiscoveryErrorLike): boolean {
  if (event.discoveryReason === "oauth_reconnect_required") {
    return true
  }

  const serverName = getMcpDiscoveryServerName(event).toLowerCase()
  const error = (event.error ?? "").toLowerCase()
  const isMcpContextForge =
    serverName.includes("mcp context forge") ||
    serverName.includes("context forge") ||
    error.includes("mcp context forge")
  const hasReconnectText =
    error.includes("reconnect your configured oauth account") ||
    error.includes("reconnect okta") ||
    (error.includes("oauth") && error.includes("reconnect"))

  return isMcpContextForge && hasReconnectText
}

export type RuntimeActivityType =
  | "created"
  | "status_changed"
  | "keep_alive_changed"
  | "keep_alive_change_failed"
  | "error"

export type SandboxActivityType = RuntimeActivityType

export interface RuntimeActivityEvent {
  id: string
  type: RuntimeActivityType | string
  sandboxId: string | null
  summary: string
  statusFrom: string | null
  statusTo: string | null
  keepAlive: boolean | null
  reason: string | null
  data: Record<string, unknown>
  createdAt: number
  durationSincePreviousMs: number | null
}

export type SandboxActivityEvent = RuntimeActivityEvent

export interface RuntimeActivityResponse {
  activity: RuntimeActivityEvent[]
}

export type SandboxActivityResponse = RuntimeActivityResponse

export type {
  ClientMessage,
  ParticipantPresence,
  RuntimeSessionEvent,
  SandboxEvent,
  ServerMessage,
  SessionEvent,
  SessionState,
} from "./session-events"

// Repository types for GitHub repositories visible to a user
export interface InstallationRepository {
  id: number
  owner: string
  name: string
  fullName: string
  description: string | null
  private: boolean
  defaultBranch: string
  installationId?: number
  permissions?: GitHubRepositoryPermissions
}

export interface RepoMetadata {
  description?: string
  aliases?: string[]
  channelAssociations?: string[]
  keywords?: string[]
}

export interface EnrichedRepository extends InstallationRepository {
  metadata?: RepoMetadata
}

export interface GitHubRepositoryPermissions {
  contents: "read" | "write" | null
  pullRequests: "read" | "write" | null
  metadata: "read" | "write" | null
  userCanPull: boolean
  userCanPush: boolean
  userCanAdmin: boolean
  canPush: boolean
  canOpenPullRequests: boolean
}

// API response types
export interface CreateSessionRequest {
  sessionKind?: SessionKind
  agentRuntime?: AgentRuntime
  repoOwner?: string
  repoName?: string
  tools?: SessionToolSpec[]
  customMcpServers?: OpenCodeMcpServers
  secretKeys?: string[]
  isolateStepLimit?: number
  subagents?: SubagentMode
  title?: string
  model?: string
  reasoningEffort?: string
  incognito?: boolean
}

export interface CreateSessionResponse {
  sessionId: string
  sessionKind: SessionKind
  agentRuntime: AgentRuntime
  status: SessionStatus
}

export interface ListSessionsResponse {
  sessions: Session[]
  cursor?: string
  hasMore: boolean
}

// --- Compatibility types for existing repo consumers ---

export interface SessionSummary {
  id: string
  sessionKind: SessionKind
  agentRuntime: AgentRuntime
  source?: SessionInitiationSource
  title: string | null
  repoOwner: string
  repoName: string
  githubInstallationId?: number | null
  githubRepoId?: number | null
  repoDefaultBranch?: string | null
  branchName?: string | null
  tools?: SessionToolSpec[]
  customMcpServers?: OpenCodeMcpServers
  isolateStepLimit?: number
  subagents?: SubagentMode
  model: string
  reasoningEffort?: string
  incognito?: boolean
  status: SessionStatus
  createdAt: number
  updatedAt: number
}

export interface CreateSessionInput {
  sessionKind?: SessionKind
  agentRuntime?: AgentRuntime
  repoOwner?: string
  repoName?: string
  tools?: SessionToolSpec[]
  customMcpServers?: OpenCodeMcpServers
  isolateStepLimit?: number
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

export interface PromptInput {
  content: string
  authorId?: string
  source?: "web" | "slack" | "extension" | "github"
  model?: string
  reasoningEffort?: string
  attachments?: Array<{
    type: "file" | "image" | "url"
    name: string
    url?: string
  }>
  callbackContext?: SlackCallbackContext
}

export interface PromptResponse {
  messageId: string
  status: string
  output?: string
  error?: string
}

export interface RunSessionInput extends CreateSessionInput {
  sessionId?: string
  content: string
  source?: MessageSource
  attachments?: PromptInput["attachments"]
  callbackContext?: SlackCallbackContext
}

export interface RunSessionResponse {
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

export interface WsSubscribePayload {
  token: string
  clientId: string
}

export type TimelineEvent =
  | {
      type: "user_message"
      content: string
      messageId: string
      timestamp: number
      author: { participantId: string; name: string }
    }
  | {
      type: "token"
      content: string
      messageId: string
      assistantMessageId?: string
      sandboxId: string
      timestamp: number
    }
  | {
      type: "reasoning"
      content: string
      messageId: string
      assistantMessageId: string
      sandboxId: string
      timestamp: number
    }
  | {
      type: "execution_complete"
      messageId: string
      success: boolean
      sandboxId: string
      timestamp: number
      error?: string
    }
  | {
      type: "error"
      error: string
      messageId: string
      sandboxId: string
      timestamp: number
    }

export interface SlackCallbackContext {
  /** Optional to remain wire-compatible with callback payloads created before tagging. */
  type?: "slack"
  channel: string
  threadTs: string
  repoFullName: string
  model: string
  reactionMessageTs?: string
}

export interface WorkflowCallbackContext {
  type: "workflow"
  workflowId: string
  runId: string
  nodeId: string
}

export type SessionCallbackContext = SlackCallbackContext | WorkflowCallbackContext

export interface OAuthSetupLinkResponse {
  error: string
  setupUrl: string
}

export interface SlackCreateSessionRequest {
  sessionKind?: SessionKind
  agentRuntime?: AgentRuntime
  slackUserId: string
  repoOwner?: string
  repoName?: string
  tools?: SessionToolSpec[]
  customMcpServers?: OpenCodeMcpServers
  isolateStepLimit?: number
  subagents?: SubagentMode
  title?: string
  model?: string
  reasoningEffort?: string
  githubLogin?: string
  githubName?: string
  githubEmail?: string
  incognito?: boolean
}

export interface UpdateSessionToolsRequest {
  tools?: SessionToolSpec[]
  customMcpServers?: OpenCodeMcpServers
  isolateStepLimit?: number
  subagents?: SubagentMode
}

export interface SlackCreateSessionResponse {
  sessionId: string
  sessionKind: SessionKind
  agentRuntime: AgentRuntime
  status: SessionStatus
}
