import type { OpenCodeMcpServers } from "./provider-config"
import type { SessionToolSpec } from "./session-tools"
import type { AgentRuntime, SessionKind } from "./agent-runtime"
import type { SubagentMode } from "./subagents"
import type {
  Attachment,
  McpDiscoveryErrorReason,
  RuntimeActivityEvent,
  SandboxStatus,
  SessionArtifactMetadata,
  SessionEventMetadata,
  SessionRuntimeCapabilities,
  SessionStatus,
} from "./types"

export interface SessionEventCommon {
  sandboxId?: string
  timestamp: number
  messageId?: string
  assistantMessageId?: string
  content?: string
  tool?: string
  args?: Record<string, unknown>
  callId?: string
  serverName?: string
  terminal?: boolean
  discoveryReason?: McpDiscoveryErrorReason
  result?: string
  output?: string
  error?: string
  success?: boolean
  stepLimit?: number
  resumedFromMessageId?: string
  reason?: string
  summary?: string
  status?: string
  sha?: string
  artifactType?: string
  url?: string
  metadata?: SessionEventMetadata
  author?: {
    participantId: string
    name: string
    avatar?: string
  }
}

export type SubagentRunStatus = "running" | "completed" | "error" | "aborted" | "interrupted"

export type SubagentInterruptedReason =
  | "no-progress"
  | "window-exceeded"
  | "not-tailable"
  | "inspect-timeout"
  | "inspect-failed"
  | "recovery-deadline"
  | "budget-exceeded"

export interface SubagentProgress {
  fraction?: number
  message?: string
  phase?: string
  milestone?: string
  /** Epoch milliseconds, matching the Cloudflare Agents progress contract. */
  at: number
}

export interface SubagentMilestone {
  name: string
  sequence: number
  /** Epoch milliseconds, matching the Cloudflare Agents milestone contract. */
  at: number
}

export interface SubagentRunSummary {
  runId: string
  parentToolCallId?: string
  agentType: string
  task?: string
  model?: string
  status: SubagentRunStatus
  /** Session event timestamps are epoch seconds. */
  startedAt: number
  /** Session event timestamps are epoch seconds. */
  completedAt?: number
  durationMs?: number
  toolCallCount: number
  toolNames: string[]
  summary?: string
  error?: string
  progress?: SubagentProgress
  milestones?: SubagentMilestone[]
  reason?: SubagentInterruptedReason
  childStillRunning?: boolean
}

interface SubagentSessionEventBase {
  type: "subagent_event"
  /** Stable persistence/deduplication identity: `sae_${runId}_${sequence}`. */
  eventId: string
  runId: string
  /** Monotonic sequence assigned by the parent Agent for this run. */
  sequence: number
  parentToolCallId?: string
  messageId: string
  sandboxId: string
  timestamp: number
  replay?: true
}

/**
 * Durable, SDK-independent projection of Cloudflare's AgentToolEventMessage.
 * Chunk bodies stay serialized so the relay never needs to reinterpret model output.
 */
export type SubagentSessionEvent = SubagentSessionEventBase &
  (
    | {
        kind: "started"
        agentType: string
        order: number
        /** Sanitized and truncated by the runtime before persistence. */
        task?: string
        model?: string
        displayName?: string
      }
    | {
        kind: "chunk"
        /** A validated, serialized AI SDK UIMessageChunk. */
        body: string
      }
    | {
        kind: "finished"
        summary: string
      }
    | {
        kind: "error"
        error: string
      }
    | {
        kind: "aborted"
        reason?: string
      }
    | {
        kind: "interrupted"
        error: string
        reason?: SubagentInterruptedReason
        childStillRunning?: boolean
      }
  )

export type OpenCodeInteractionKind = "permission" | "question"
export type OpenCodePermissionReply = "once" | "always" | "reject"

export interface OpenCodeInteractionTool {
  messageID: string
  callID: string
}

export interface OpenCodeInteractionQuestionOption {
  label: string
  description: string
}

export interface OpenCodeInteractionQuestion {
  question: string
  header: string
  options: OpenCodeInteractionQuestionOption[]
  multiple?: boolean
  custom?: boolean
}

export type OpenCodeInteractionRequest =
  | {
      runtime: "opencode"
      kind: "permission"
      interactionId: string
      requestId: string
      opencodeSessionId: string
      title: string
      permission: string
      patterns: string[]
      always: string[]
      tool?: OpenCodeInteractionTool
      messageId: string
      sandboxId: string
      timestamp: number
    }
  | {
      runtime: "opencode"
      kind: "question"
      interactionId: string
      requestId: string
      opencodeSessionId: string
      title: string
      questions: OpenCodeInteractionQuestion[]
      tool?: OpenCodeInteractionTool
      messageId: string
      sandboxId: string
      timestamp: number
    }

export type OpenCodeInteractionResponse =
  | {
      runtime: "opencode"
      kind: "permission"
      interactionId: string
      reply: OpenCodePermissionReply
      message?: string
    }
  | {
      runtime: "opencode"
      kind: "question"
      interactionId: string
      answers?: string[][]
      rejected?: boolean
    }

type SessionEventPayload =
  | { type: "heartbeat"; sandboxId: string; timestamp: number }
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
      type: "tool_call"
      tool: string
      args: Record<string, unknown>
      callId: string
      messageId: string
      sandboxId: string
      timestamp: number
      output?: string
      result?: string
      error?: string
      success?: boolean
    }
  | {
      type: "tool_result"
      callId: string
      result: string
      error?: string
      messageId: string
      sandboxId: string
      timestamp: number
    }
  | {
      type: "mcp_discovery_error"
      serverName: string
      error: string
      terminal?: boolean
      discoveryReason?: McpDiscoveryErrorReason
      messageId: string
      sandboxId: string
      timestamp: number
      metadata?: SessionEventMetadata
    }
  | {
      type: "step_limit_warning"
      stepLimit: number
      content?: string
      messageId: string
      sandboxId: string
      timestamp: number
    }
  | {
      type: "execution_complete"
      messageId: string
      success: boolean
      error?: string
      sandboxId: string
      timestamp: number
    }
  | {
      type: "user_message"
      content: string
      messageId: string
      timestamp: number
      sandboxId?: string
      author?: {
        participantId: string
        name: string
        avatar?: string
      }
    }
  | {
      type: "resume_started"
      messageId: string
      resumedFromMessageId: string
      reason: "okta_reconnect"
      summary: string
      sandboxId: string
      timestamp: number
    }
  | {
      type: "push_complete"
      branchName: string
      sandboxId?: string
      timestamp: number
    }
  | {
      type: "push_error"
      branchName: string
      error: string
      sandboxId?: string
      timestamp: number
    }
  | {
      type: "git_sync"
      status: string
      sha?: string
      success?: boolean
      messageId?: string
      sandboxId: string
      timestamp: number
    }
  | {
      type: "artifact"
      artifactType: string
      url?: string
      metadata?: SessionArtifactMetadata
      messageId?: string
      sandboxId: string
      timestamp: number
    }
  | ({
      type: "interaction_request"
    } & OpenCodeInteractionRequest)
  | ({
      type: "interaction_response"
      messageId: string
      sandboxId: string
      timestamp: number
      author?: {
        participantId: string
        name: string
        avatar?: string
      }
    } & OpenCodeInteractionResponse)
  | {
      type: "error"
      error: string
      messageId: string
      sandboxId: string
      timestamp: number
    }
  | SubagentSessionEvent

export type SessionEvent = SessionEventPayload & SessionEventCommon
export type SandboxEvent = SessionEvent
export type RuntimeSessionEvent = SessionEvent

export type ClientMessage =
  | { type: "ping" }
  | { type: "subscribe"; token: string; clientId: string }
  | { type: "typing" }
  | { type: "stop" }
  | {
      type: "prompt"
      content: string
      model?: string
      reasoningEffort?: string
      attachments?: Attachment[]
    }
  | {
      type: "fetch_history"
      cursor: { timestamp: number; id: string }
      limit?: number
    }
  | {
      type: "presence"
      status: "active" | "idle"
      cursor?: { line: number; file: string }
    }
  | ({
      type: "interaction_reply"
    } & OpenCodeInteractionResponse)

export type ServerMessage =
  | { type: "pong"; timestamp: number }
  | {
      type: "subscribed"
      sessionId: string
      state: SessionState
      participantId: string
      participant?: {
        participantId: string
        name: string
        avatar?: string
      }
    }
  | {
      type: "session_state"
      state: SessionState
    }
  | { type: "prompt_queued"; messageId: string; position: number }
  | { type: "sandbox_event"; event: SandboxEvent }
  | { type: "runtime_activity_snapshot"; activity: RuntimeActivityEvent[] }
  | { type: "runtime_activity"; activity: RuntimeActivityEvent }
  | { type: "presence_sync"; participants: ParticipantPresence[] }
  | { type: "presence_update"; participants: ParticipantPresence[] }
  | { type: "presence_leave"; userId: string }
  | { type: "sandbox_status"; status: SandboxStatus | string }
  | { type: "sandbox_error"; error: string }
  | { type: "sandbox_warming" }
  | { type: "sandbox_spawning" }
  | { type: "sandbox_ready" }
  | { type: "processing_status"; isProcessing: boolean }
  | {
      type: "history_page"
      items: SandboxEvent[]
      hasMore: boolean
      cursor: { timestamp: number; id: string } | null
    }
  | {
      type: "replay_complete"
      hasMore: boolean
      cursor: { timestamp: number; id: string } | null
    }
  | {
      type: "artifact_created" | "artifact_updated"
      artifact: {
        id: string
        type: string
        url: string | null
        metadata?: SessionArtifactMetadata | null
        prNumber?: number
        createdAt: number
      }
    }
  | { type: "session_status"; status: SessionStatus }
  | { type: "error"; code: string; message: string }

export interface SessionState {
  id: string
  sessionKind: SessionKind
  agentRuntime: AgentRuntime
  title: string | null
  repoOwner: string
  repoName: string
  tools?: SessionToolSpec[]
  customMcpServers?: OpenCodeMcpServers
  secretKeys?: string[]
  isolateStepLimit?: number
  subagents?: SubagentMode
  branchName?: string | null
  status: SessionStatus
  sandboxStatus: SandboxStatus | string
  runtimeStatus: string
  runtimeError?: string | null
  capabilities?: SessionRuntimeCapabilities
  messageCount: number
  createdAt: number
  updatedAt?: number
  model?: string
  reasoningEffort?: string
  isProcessing: boolean
}

export interface ParticipantPresence {
  participantId: string
  userId: string
  name: string
  avatar?: string
  status: "active" | "idle" | "away"
  lastSeen: number
}
