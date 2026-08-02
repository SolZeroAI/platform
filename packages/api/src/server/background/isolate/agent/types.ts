import * as Match from "effect/Match"
import * as Option from "effect/Option"
import type { StreamCallback } from "@cloudflare/think"
import {
  getGitHubRepoTool,
  type OpenCodeMcpServers,
  type SessionToolSpec,
  type SubagentMode,
  type SubagentRunSummary,
} from "@c0-agent/shared"
import type { LocalSpanContext } from "../../observability/tracing"
import type { IsolateMcpcfMcpPromptServer } from "../../session/isolate/system"
import type { IsolateModelContext } from "../model"
import type { SubagentDispatchState } from "./subagent-dispatch-state"

export const SESSION_METADATA_PATH = "/session.json"
export const DEFAULT_GLOB_PATTERN = "**/*"
export const DEFAULT_GLOB_LIMIT = 200
export const DEFAULT_SEARCH_LIMIT = 20

export type IsolateRuntimeStatus =
  | "pending"
  | "warming"
  | "ready"
  | "running"
  | "failed"
  | "stopped"

export interface IsolateSessionCapabilities {
  agentRuntime: "isolate"
  supportsWorkspace: true
  supportsGit: true
  supportsDocs: boolean
  supportsRepoWorkspace: boolean
}

export interface IsolateSessionConfig {
  sessionId: string
  userId: string
  repoOwner: string
  repoName: string
  repoDefaultBranch?: string | null
  branchName?: string | null
  model: string
  isolateStepLimit?: number | null
  subagents?: SubagentMode | null
  githubName?: string | null
  githubEmail?: string | null
  tools?: SessionToolSpec[]
  customMcpServers?: OpenCodeMcpServers
  secretEnv?: Record<string, string>
}

export interface IsolateCloneAuth {
  githubAccessToken?: string | null
}

export interface IsolateWarmResult {
  runtimeId: string
  status: IsolateRuntimeStatus
  lastError?: string | null
}

export interface IsolatePromptRequest extends IsolateCloneAuth {
  messageId: string
  content: string
  model: string
  observabilityTrace?: LocalSpanContext
  reasoningEffort?: string
}

export interface IsolatePromptResult {
  runtimeId: string
  output: string
  status: IsolateRuntimeStatus
  lastError?: string | null
  capabilities: IsolateSessionCapabilities
  subagentRuns?: SubagentRunSummary[]
}

export interface IsolateSessionAgentState extends IsolateSessionConfig {
  runtimeStatus: IsolateRuntimeStatus
  lastError: string | null
  /** Bounded, durable claims for the active parent response. */
  subagentDispatch?: SubagentDispatchState
}

export interface ActiveTurn {
  model: IsolateModelContext
  requestedModel: string
  reasoningEffort?: string
  auth?: IsolateCloneAuth
  repoWarning?: string | null
  customMcpServerNames?: readonly string[]
  mcpcfMcpServers?: readonly IsolateMcpcfMcpPromptServer[]
  finalizingAfterStepLimit?: boolean
  messageId: string
  callback?: StreamCallback
  /** True only when the turn was reconstructed by Think after an interruption. */
  recovered?: boolean
}

export function buildCapabilities(state: IsolateSessionAgentState): IsolateSessionCapabilities {
  const tools = state.tools ?? []
  const repoTool = getGitHubRepoTool(tools)
  const supportsDocs = tools.some((tool) => tool.kind === "ai_search")
  return {
    agentRuntime: "isolate",
    supportsWorkspace: true,
    supportsGit: true,
    supportsDocs,
    supportsRepoWorkspace: Boolean(repoTool),
  }
}

export function getStreamRequestId(requestId: string | Option.Option<string>): string {
  return Match.value(typeof requestId).pipe(
    Match.when("string", () => requestId as string),
    Match.orElse(() => Option.getOrElse(requestId as Option.Option<string>, () => "")),
  )
}
