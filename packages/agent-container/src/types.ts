export type HarnessRuntimeName = "opencode" | "codex" | "claude-code"

export interface RuntimeAuthOpenAICompatible {
  apiKey: string
  baseUrl: string
  name?: string
  modelProviderName?: string
}

export interface RuntimeAuthAnthropic {
  apiKey: string
  baseUrl: string
}

export type RuntimeProviderConfig =
  | {
      kind: "openai-compatible"
      providerId: "litellm"
      modelId: string
      auth: RuntimeAuthOpenAICompatible
    }
  | {
      kind: "anthropic"
      providerId: "litellm-anthropic"
      modelId: string
      auth: RuntimeAuthAnthropic
    }

export interface RuntimeInitRequest {
  sessionId: string
  repoOwner?: string | null
  repoName?: string | null
  repoDefaultBranch?: string | null
  branchName?: string | null
  githubAccessToken?: string | null
  githubLogin?: string | null
  githubName?: string | null
  githubEmail?: string | null
  secretEnv?: Record<string, string>
}

export type RuntimeMcpServer =
  | {
      type: "remote"
      url: string
      enabled?: boolean
      headers?: Record<string, string>
      oauth?: false | Record<string, unknown>
      timeout?: number
    }
  | {
      type: "local"
      command: string[]
      enabled?: boolean
      environment?: Record<string, string>
      timeout?: number
    }

export type RuntimeMcpServers = Record<string, RuntimeMcpServer>

export interface RuntimeSkillFile {
  path: string
  content: string
}

export interface RuntimeSkillPackage {
  id: string
  contentHash: string
  name: string
  description: string
  content: string
  files?: RuntimeSkillFile[]
}

export interface RuntimeRepositoryContext {
  owner: string
  name: string
  defaultBranch: string | null
  branchName: string | null
}

export interface RuntimeSendRequest {
  messageId: string
  sessionId: string
  content: string
  model: RuntimeProviderConfig
  reasoningEffort?: string | null
  mcpServers?: RuntimeMcpServers
  secretEnv?: Record<string, string>
  skills?: RuntimeSkillPackage[]
  repository?: RuntimeRepositoryContext | null
}

export interface RuntimeSendResponse {
  ok: true
  cursor: number
}

export type RuntimeEvent =
  | { type: "text-delta"; messageId: string; id: string; text: string; timestamp: number }
  | { type: "reasoning-delta"; messageId: string; id: string; text: string; timestamp: number }
  | {
      type: "tool-call"
      messageId: string
      toolCallId: string
      toolName: string
      input: unknown
      timestamp: number
    }
  | {
      type: "tool-result"
      messageId: string
      toolCallId: string
      toolName?: string
      output: unknown
      isError?: boolean
      timestamp: number
    }
  | {
      type: "file-change"
      messageId: string
      event: "create" | "modify" | "delete"
      path: string
      timestamp: number
    }
  | {
      type: "finish"
      messageId: string
      success: boolean
      error?: string
      timestamp: number
    }
  | { type: "error"; messageId: string; error: string; timestamp: number }

export interface RuntimePollResponse {
  events: RuntimeEvent[]
  cursor: number
}
