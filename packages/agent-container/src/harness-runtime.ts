import { HarnessAgent, type HarnessAgentSession } from "@ai-sdk/harness/agent"
import type { HarnessV1, HarnessV1Skill } from "@ai-sdk/harness"
import { createClaudeCode, type ClaudeCodeThinkingConfig } from "@ai-sdk/harness-claude-code"
import { createCodex } from "@ai-sdk/harness-codex"
import { createOpenCode } from "@ai-sdk/harness-opencode"
import { createLocalSandboxProvider, WORKSPACE_DIRECTORY } from "./local-sandbox"
import { createMcpTools, type McpTools } from "./mcp-tools"
import type {
  HarnessRuntimeName,
  RuntimeEvent,
  RuntimeProviderConfig,
  RuntimeSendRequest,
} from "./types"

interface RuntimeState {
  sessionId: string
  modelSignature: string
  agent: HarnessAgent
  session: HarnessAgentSession
  mcpTools: McpTools
}

export type HarnessAdapterSettings =
  | {
      runtime: "opencode"
      settings: NonNullable<Parameters<typeof createOpenCode>[0]>
    }
  | {
      runtime: "codex"
      settings: NonNullable<Parameters<typeof createCodex>[0]>
    }
  | {
      runtime: "claude-code"
      settings: NonNullable<Parameters<typeof createClaudeCode>[0]>
    }

export interface CodingAgentRuntime {
  send(input: RuntimeSendRequest): Promise<void>
  interrupt(): Promise<void>
  poll(cursor: number): { events: RuntimeEvent[]; cursor: number }
  currentCursor(): number
  switchSession(sessionId: string): Promise<void>
  currentSession(): string | null
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (error && typeof error === "object") {
    const message = Reflect.get(error, "message")
    if (typeof message === "string" && message.length > 0) {
      return message
    }
  }
  return String(error)
}

export function claudeCodeProviderBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/v1\/?$/, "")
}

function reasoningEffort(value: string | null | undefined): "low" | "medium" | "high" | undefined {
  switch (value) {
    case "low":
    case "medium":
    case "high":
      return value
    case "xhigh":
    case "max":
      return "high"
    default:
      return undefined
  }
}

function thinkingMode(value: string | null | undefined): ClaudeCodeThinkingConfig {
  switch (value) {
    case "none":
    case "minimal":
      return { type: "disabled" }
    case "high":
    case "xhigh":
    case "max":
      return { type: "enabled", display: "summarized" }
    default:
      return { type: "adaptive", display: "summarized" }
  }
}

function openCodeReasoningVariant(value: string | null | undefined): string | undefined {
  switch (value) {
    case "none":
    case "minimal":
      return undefined
    default:
      return value ?? undefined
  }
}

export function harnessAdapterSettings(
  runtime: HarnessRuntimeName,
  model: RuntimeProviderConfig,
  reasoning: string | null | undefined,
): HarnessAdapterSettings {
  switch (runtime) {
    case "opencode":
      if (model.kind === "anthropic") {
        return {
          runtime,
          settings: {
            provider: "anthropic",
            model: model.modelId,
            auth: {
              anthropic: {
                apiKey: model.auth.apiKey,
                baseUrl: model.auth.baseUrl,
              },
            },
            reasoningVariant: openCodeReasoningVariant(reasoning),
          },
        }
      }
      return {
        runtime,
        settings: {
          provider: model.auth.name ?? "litellm",
          model: model.modelId,
          auth: {
            openaiCompatible: {
              apiKey: model.auth.apiKey,
              baseUrl: model.auth.baseUrl,
              name: model.auth.name ?? "litellm",
            },
          },
          reasoningVariant: openCodeReasoningVariant(reasoning),
        },
      }
    case "codex":
      if (model.kind !== "openai-compatible") {
        throw new Error("Codex harness requires a LiteLLM OpenAI-compatible model")
      }
      return {
        runtime,
        settings: {
          model: model.modelId,
          auth: {
            openaiCompatible: {
              apiKey: model.auth.apiKey,
              baseUrl: model.auth.baseUrl,
              modelProviderName: model.auth.modelProviderName ?? "litellm",
            },
          },
          reasoningEffort: reasoningEffort(reasoning),
          webSearch: true,
        },
      }
    case "claude-code":
      if (model.kind !== "anthropic") {
        throw new Error("Claude Code harness requires a LiteLLM Anthropic model")
      }
      return {
        runtime,
        settings: {
          model: model.modelId,
          auth: {
            anthropic: {
              apiKey: model.auth.apiKey,
              baseUrl: claudeCodeProviderBaseUrl(model.auth.baseUrl),
            },
          },
          thinking: thinkingMode(reasoning),
        },
      }
  }
}

function makeHarness(
  runtime: HarnessRuntimeName,
  model: RuntimeProviderConfig,
  reasoning: string | null | undefined,
): HarnessV1 {
  const adapter = harnessAdapterSettings(runtime, model, reasoning)
  switch (adapter.runtime) {
    case "opencode":
      return createOpenCode(adapter.settings)
    case "codex":
      return createCodex(adapter.settings)
    case "claude-code":
      return createClaudeCode(adapter.settings)
  }
}

export function buildHarnessInstructions(input: {
  runtime: HarnessRuntimeName
  model: RuntimeProviderConfig
  repository?: RuntimeSendRequest["repository"]
  mcpServers?: RuntimeSendRequest["mcpServers"]
}): string {
  const metadata = JSON.stringify({
    agentRuntime: input.runtime,
    provider: input.model.providerId,
    model: input.model.modelId,
  })
  const sections = [
    [
      "# c0 agent instructions",
      "",
      "You are a coding agent running through c0 in a real Linux container. The workspace supports shell commands, package managers, arbitrary command execution, filesystem access, and the native tools supplied by the selected agent harness.",
      "",
      `Runtime metadata: ${metadata}`,
      "Use this metadata as the source of truth when asked about your runtime, provider, or model. Report the exact values and do not infer a different model name from generic self-identification.",
    ].join("\n"),
  ]

  if (Object.keys(input.mcpServers ?? {}).length > 0) {
    sections.push(
      [
        "## MCP tools",
        "",
        "Use configured MCP tools directly from the current agent. Do not delegate MCP calls to subagents or task tools because delegated agents do not inherit these MCP permissions.",
        "Prefer configured MCP tools over public web search for the internal sources they expose. If an MCP call fails, report the exact error.",
      ].join("\n"),
    )
  }

  if (input.repository) {
    const branch = input.repository.branchName ?? "the current c0-managed branch"
    const baseBranch = input.repository.defaultBranch ?? "the repository default branch"
    sections.push(
      [
        "## Managed repository",
        "",
        `The attached repository is ${input.repository.owner}/${input.repository.name}. Work on ${branch}.`,
        "Treat the checkout, remote, and working branch as c0-managed. Do not reclone the repository, rewrite remotes, delete the workspace, or switch to the default branch.",
        `Commit and push changes only from the c0-managed branch. Never push directly to ${baseBranch}.`,
      ].join("\n"),
    )
  }

  return sections.join("\n\n")
}

export function harnessSkills(skills: RuntimeSendRequest["skills"]): HarnessV1Skill[] {
  return (skills ?? []).map((skill) => ({
    name: skill.name,
    description: skill.description,
    content: skill.content,
    files: skill.files,
  }))
}

export function runtimeConfigurationSignature(input: RuntimeSendRequest): string {
  return JSON.stringify({
    model: input.model,
    reasoningEffort: input.reasoningEffort ?? null,
    mcpServers: input.mcpServers ?? {},
    secretEnv: Object.entries(input.secretEnv ?? {}).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
    repository: input.repository ?? null,
    skills: (input.skills ?? []).map((skill) => ({
      id: skill.id,
      contentHash: skill.contentHash,
    })),
  })
}

function partText(part: Record<string, unknown>): string {
  const value = part.text ?? part.delta
  return typeof value === "string" ? value : ""
}

function partToolCallId(part: Record<string, unknown>): string {
  const value = part.toolCallId ?? part.toolCallID ?? part.id
  return typeof value === "string" ? value : "tool-call"
}

function partToolName(part: Record<string, unknown>): string {
  const value = part.toolName ?? part.tool ?? part.nativeName
  return typeof value === "string" ? value : "tool"
}

function fileChangeEvent(
  part: Record<string, unknown>,
  messageId: string,
  timestamp: number,
): RuntimeEvent | null {
  if (part.toolName !== "fileChange" || typeof part.input !== "object" || part.input === null) {
    return null
  }
  const input = part.input as Record<string, unknown>
  if (
    (input.event !== "create" && input.event !== "modify" && input.event !== "delete") ||
    typeof input.path !== "string"
  ) {
    return null
  }
  return {
    type: "file-change",
    messageId,
    event: input.event,
    path: input.path,
    timestamp,
  }
}

export function mapStreamPart(part: unknown, messageId: string): RuntimeEvent | null {
  if (typeof part !== "object" || part === null || !("type" in part)) {
    return null
  }
  const value = part as Record<string, unknown>
  const timestamp = Date.now()
  switch (value.type) {
    case "text-delta":
      return {
        type: "text-delta",
        messageId,
        id: typeof value.id === "string" ? value.id : messageId,
        text: partText(value),
        timestamp,
      }
    case "reasoning-delta":
      return {
        type: "reasoning-delta",
        messageId,
        id: typeof value.id === "string" ? value.id : `${messageId}-reasoning`,
        text: partText(value),
        timestamp,
      }
    case "tool-call":
      return (
        fileChangeEvent(value, messageId, timestamp) ?? {
          type: "tool-call",
          messageId,
          toolCallId: partToolCallId(value),
          toolName: partToolName(value),
          input: value.input ?? value.args ?? {},
          timestamp,
        }
      )
    case "tool-result":
      if (value.toolName === "fileChange") {
        return null
      }
      return {
        type: "tool-result",
        messageId,
        toolCallId: partToolCallId(value),
        toolName: typeof value.toolName === "string" ? value.toolName : undefined,
        output: value.output ?? value.result ?? "",
        isError: value.isError === true,
        timestamp,
      }
    case "tool-error":
      return {
        type: "tool-result",
        messageId,
        toolCallId: partToolCallId(value),
        toolName: typeof value.toolName === "string" ? value.toolName : undefined,
        output: stringifyError(value.error),
        isError: true,
        timestamp,
      }
    case "file-change":
      return {
        type: "file-change",
        messageId,
        event:
          value.event === "create" || value.event === "modify" || value.event === "delete"
            ? value.event
            : "modify",
        path: typeof value.path === "string" ? value.path : "",
        timestamp,
      }
    case "error":
      return {
        type: "error",
        messageId,
        error: stringifyError(value.error),
        timestamp,
      }
    case "finish":
      return {
        type: "finish",
        messageId,
        success: value.finishReason !== "error",
        error:
          value.finishReason === "error"
            ? typeof value.rawFinishReason === "string"
              ? value.rawFinishReason
              : "Agent runtime finished with an error"
            : undefined,
        timestamp,
      }
    case "abort":
      return {
        type: "error",
        messageId,
        error: typeof value.reason === "string" ? value.reason : "Agent runtime interrupted",
        timestamp,
      }
    default:
      return null
  }
}

export function createCodingAgentRuntime(runtime: HarnessRuntimeName): CodingAgentRuntime {
  let current: RuntimeState | null = null
  let requestedSessionId: string | null = null
  let runningAbortController: AbortController | null = null
  const events: RuntimeEvent[] = []

  async function destroyCurrent() {
    if (current) {
      await current.session.destroy().catch(() => undefined)
      await current.mcpTools.close()
      current = null
    }
  }

  async function ensureSession(input: RuntimeSendRequest): Promise<RuntimeState> {
    const signature = runtimeConfigurationSignature(input)
    const nextSessionId = requestedSessionId ?? input.sessionId
    if (current && current.sessionId === nextSessionId && current.modelSignature === signature) {
      return current
    }
    await destroyCurrent()
    const mcpTools = await createMcpTools(input.mcpServers)
    try {
      const agent = new HarnessAgent({
        harness: makeHarness(runtime, input.model, input.reasoningEffort),
        sandbox: createLocalSandboxProvider({
          id: nextSessionId,
          env: input.secretEnv,
        }),
        sandboxConfig: {
          workDir: WORKSPACE_DIRECTORY,
        },
        permissionMode: "allow-all",
        instructions: buildHarnessInstructions({
          runtime,
          model: input.model,
          repository: input.repository,
          mcpServers: input.mcpServers,
        }),
        skills: harnessSkills(input.skills),
        tools: mcpTools.tools,
      })
      const session = await agent.createSession({ sessionId: nextSessionId })
      current = {
        sessionId: nextSessionId,
        modelSignature: signature,
        agent,
        session,
        mcpTools,
      }
      return current
    } catch (error) {
      await mcpTools.close()
      throw error
    }
  }

  async function send(input: RuntimeSendRequest) {
    const abortController = new AbortController()
    runningAbortController = abortController
    let emittedFinish = false
    let emittedError: string | null = null
    try {
      const state = await ensureSession(input)
      const result = await state.agent.stream({
        session: state.session,
        prompt: input.content,
        abortSignal: abortController.signal,
      } as Parameters<HarnessAgent["stream"]>[0])
      for await (const part of result.fullStream) {
        const event = mapStreamPart(part, input.messageId)
        if (!event) {
          continue
        }
        if (event.type === "finish") {
          emittedFinish = true
        } else if (event.type === "error") {
          emittedError = event.error
        }
        events.push(event)
      }
      if (!emittedFinish) {
        events.push({
          type: "finish",
          messageId: input.messageId,
          success: emittedError === null,
          error: emittedError ?? undefined,
          timestamp: Date.now(),
        })
      }
    } catch (error) {
      const message = stringifyError(error)
      events.push({
        type: "error",
        messageId: input.messageId,
        error: message,
        timestamp: Date.now(),
      })
      events.push({
        type: "finish",
        messageId: input.messageId,
        success: false,
        error: message,
        timestamp: Date.now(),
      })
    } finally {
      if (runningAbortController === abortController) {
        runningAbortController = null
      }
    }
  }

  return {
    send,
    async interrupt() {
      runningAbortController?.abort()
    },
    poll(cursor) {
      return {
        events: events.slice(cursor),
        cursor: events.length,
      }
    },
    currentCursor() {
      return events.length
    },
    async switchSession(sessionId) {
      requestedSessionId = sessionId
      await destroyCurrent()
    },
    currentSession() {
      return current?.sessionId ?? requestedSessionId
    },
  }
}
