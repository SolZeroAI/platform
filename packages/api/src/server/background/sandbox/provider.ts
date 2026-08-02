import type {
  AgentRuntime,
  OpenCodeInteractionRequest,
  OpenCodeInteractionResponse,
  OpenCodeMcpServers,
} from "@c0-agent/shared"
import type { Effect } from "effect/Effect"
import type { Attachment, SandboxEvent } from "../types"

export interface SandboxProviderCapabilities {
  supportsSnapshots: boolean
  supportsRestore: boolean
  supportsWarm: boolean
}

export interface CreateSandboxConfig {
  sessionId: string
  agentRuntime?: AgentRuntime
  sandboxId: string
  sandboxAuthToken: string
  controlPlaneUrl: string
  repoOwner?: string | null
  repoName?: string | null
  repoDefaultBranch?: string | null
  branchName?: string | null
  userId: string
  githubUserId?: string | null
  githubAccessToken?: string | null
  githubLogin?: string | null
  githubName?: string | null
  githubEmail?: string | null
  model: string
  mcpServers?: OpenCodeMcpServers
  secretEnv?: Record<string, string>
}

export interface CreateSandboxResult {
  sandboxId: string
  status: string
  createdAt: number
}

export interface PromptAuthor {
  userId: string
  githubName: string | null
  githubEmail: string | null
}

export interface PromptRequest {
  messageId: string
  agentRuntime: AgentRuntime
  content: string
  model: string
  reasoningEffort?: string
  author: PromptAuthor
  attachments?: Attachment[]
  mcpServers?: OpenCodeMcpServers
  secretEnv?: Record<string, string>
  requestInteraction?: (request: OpenCodeInteractionRequest) => Promise<OpenCodeInteractionResponse>
}

export interface PromptExecutionResult {
  success: boolean
  error?: string
}

export interface RuntimeConfigInput {
  userId: string
  model: string
  mcpServers?: OpenCodeMcpServers
  secretEnv?: Record<string, string>
}

type SandboxProviderResult<A> = Effect<A, Error>

export interface SandboxProvider {
  readonly name: string
  readonly capabilities: SandboxProviderCapabilities

  createSandbox(config: CreateSandboxConfig): SandboxProviderResult<CreateSandboxResult>
  warmSandbox(config: CreateSandboxConfig): SandboxProviderResult<CreateSandboxResult>
  destroySandbox(
    sessionId: string,
    sandboxId: string,
    agentRuntime: AgentRuntime,
  ): SandboxProviderResult<void>
  runPrompt(
    sessionId: string,
    sandboxId: string,
    request: PromptRequest,
    onEvent: (event: SandboxEvent) => Promise<void>,
  ): SandboxProviderResult<PromptExecutionResult>
  syncRuntimeConfig(
    sessionId: string,
    sandboxId: string,
    config: RuntimeConfigInput,
  ): SandboxProviderResult<void>
  stopPrompt(
    sessionId: string,
    sandboxId: string,
    agentRuntime: AgentRuntime,
  ): SandboxProviderResult<void>
}
