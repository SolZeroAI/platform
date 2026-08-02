/* oxlint-disable c0-lint/no-if-statement, c0-lint/prefer-option-over-null, c0-lint/no-ternary, c0-lint/no-return-in-arrow, c0-lint/no-return-in-callback, c0-lint/avoid-untagged-errors -- Container HTTP and AI SDK event adapters validate untrusted JSON at an imperative boundary before entering the Effect lifecycle. */
import {
  resolveAgentRuntime,
  type AgentRuntime,
  type CompiledOpenCodeConfig,
} from "@c0-agent/shared"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import { toError } from "../../../lib/effect-errors"
import { compileOpenCodeConfigForModel } from "../../provider-catalog"
import { resolveRuntimeSkillPackages } from "../../skills/catalog"
import type { Env, SandboxEvent } from "../../types"
import type {
  CreateSandboxConfig,
  PromptRequest,
  RuntimeConfigInput,
  SandboxProvider,
} from "../provider"

type AgentContainerRuntime = Exclude<AgentRuntime, "isolate">

type RuntimeProviderConfig =
  | {
      kind: "openai-compatible"
      providerId: "litellm"
      modelId: string
      auth: {
        apiKey: string
        baseUrl: string
        name: string
        modelProviderName: string
      }
    }
  | {
      kind: "anthropic"
      providerId: "litellm-anthropic"
      modelId: string
      auth: {
        apiKey: string
        baseUrl: string
      }
    }

type RuntimeEvent =
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

interface RuntimePollResponse {
  events: RuntimeEvent[]
  cursor: number
}

interface RuntimeSendResponse {
  ok: true
  cursor: number
}

interface RuntimeSessionState {
  text: string
  reasoningById: Map<string, string>
}

function runtimeForConfig(config: CreateSandboxConfig | { agentRuntime?: AgentRuntime | null }) {
  const agentRuntime = resolveAgentRuntime({
    agentRuntime: config.agentRuntime,
    sessionKind: "sandbox",
  })
  if (agentRuntime === "isolate") {
    throw new Error("Harness container provider cannot run isolate sessions")
  }
  return agentRuntime
}

function harnessRuntime(agentRuntime: AgentRuntime): AgentContainerRuntime {
  if (agentRuntime === "isolate") {
    throw new Error("Harness container provider cannot run isolate sessions")
  }
  return agentRuntime
}

function namespaceForRuntime(env: Env, runtime: AgentContainerRuntime): DurableObjectNamespace {
  const binding = Match.value(runtime).pipe(
    Match.when("opencode", () => Reflect.get(env, "OPENCODE_AGENT")),
    Match.when("codex", () => Reflect.get(env, "CODEX_AGENT")),
    Match.when("claude-code", () => Reflect.get(env, "CLAUDE_CODE_AGENT")),
    Match.exhaustive,
  )
  if (!binding) {
    throw new Error(`Agent runtime '${runtime}' is not bound to the API Worker`)
  }
  return binding as DurableObjectNamespace
}

function agentStub(env: Env, runtime: AgentContainerRuntime, runtimeId: string): DurableObjectStub {
  const namespace = namespaceForRuntime(env, runtime)
  return namespace.get(namespace.idFromName(runtimeId))
}

async function fetchContainer(
  stub: DurableObjectStub,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return stub.fetch(`http://agent-container${path}`, init)
}

async function postJson(stub: DurableObjectStub, path: string, body: unknown): Promise<Response> {
  return fetchContainer(stub, path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

async function requireOk(response: Response, action: string): Promise<void> {
  if (response.ok) {
    return
  }
  const body = await response.text().catch(() => "")
  throw new Error(`${action} failed (${response.status}): ${body}`)
}

function requireProviderOption(
  config: CompiledOpenCodeConfig,
  providerId: string,
  optionName: string,
): string {
  const value = config.provider[providerId]?.options?.[optionName]
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Provider '${providerId}' is missing '${optionName}'`)
  }
  return value
}

function runtimeProviderConfig(input: {
  runtime: AgentContainerRuntime
  providerId: string
  modelId: string
  config: CompiledOpenCodeConfig
}): RuntimeProviderConfig {
  const apiKey = requireProviderOption(input.config, input.providerId, "apiKey")
  const baseUrl = requireProviderOption(input.config, input.providerId, "baseURL")
  return Match.value(input.providerId).pipe(
    Match.when("litellm", () => ({
      kind: "openai-compatible" as const,
      providerId: "litellm" as const,
      modelId: input.modelId,
      auth: {
        apiKey,
        baseUrl,
        name: "litellm",
        modelProviderName: "litellm",
      },
    })),
    Match.when("litellm-anthropic", () => ({
      kind: "anthropic" as const,
      providerId: "litellm-anthropic" as const,
      modelId: input.modelId,
      auth: {
        apiKey,
        baseUrl,
      },
    })),
    Match.orElse(() => {
      throw new Error(
        `Provider '${input.providerId}' is not compatible with ${input.runtime} runtime`,
      )
    }),
  )
}

function assertRuntimeProviderCompatibility(
  runtime: AgentContainerRuntime,
  provider: RuntimeProviderConfig,
): void {
  const ok = Match.value(runtime).pipe(
    Match.when("opencode", () => true),
    Match.when("codex", () => provider.kind === "openai-compatible"),
    Match.when("claude-code", () => provider.kind === "anthropic"),
    Match.exhaustive,
  )
  if (!ok) {
    throw new Error(
      `Model '${provider.providerId}/${provider.modelId}' is not compatible with ${runtime}`,
    )
  }
}

function timestampSeconds(event: { timestamp: number }): number {
  return event.timestamp / 1000
}

function stringifyOutput(value: unknown): string {
  if (typeof value === "string") {
    return value
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function mapRuntimeEvent(
  event: RuntimeEvent,
  sandboxId: string,
  state: RuntimeSessionState,
): SandboxEvent | null {
  switch (event.type) {
    case "text-delta": {
      state.text += event.text
      return {
        type: "token",
        content: state.text,
        messageId: event.messageId,
        sandboxId,
        timestamp: timestampSeconds(event),
      }
    }
    case "reasoning-delta": {
      const next = `${state.reasoningById.get(event.id) ?? ""}${event.text}`
      state.reasoningById.set(event.id, next)
      return {
        type: "reasoning",
        content: next,
        messageId: event.messageId,
        assistantMessageId: event.id,
        sandboxId,
        timestamp: timestampSeconds(event),
      }
    }
    case "tool-call":
      return {
        type: "tool_call",
        messageId: event.messageId,
        sandboxId,
        tool: event.toolName,
        args:
          typeof event.input === "object" && event.input !== null
            ? (event.input as Record<string, unknown>)
            : { input: event.input },
        callId: event.toolCallId,
        timestamp: timestampSeconds(event),
      }
    case "tool-result":
      return {
        type: "tool_result",
        messageId: event.messageId,
        sandboxId,
        tool: event.toolName ?? "tool",
        result: stringifyOutput(event.output),
        callId: event.toolCallId,
        success: event.isError !== true,
        timestamp: timestampSeconds(event),
      }
    case "file-change":
      return {
        type: "tool_call",
        messageId: event.messageId,
        sandboxId,
        tool: "file_change",
        args: { event: event.event, path: event.path },
        callId: `file-change:${event.path}:${event.timestamp}`,
        timestamp: timestampSeconds(event),
      }
    case "error":
      return {
        type: "error",
        messageId: event.messageId,
        sandboxId,
        error: event.error,
        timestamp: timestampSeconds(event),
      }
    case "finish":
      return {
        type: "execution_complete",
        messageId: event.messageId,
        success: event.success,
        error: event.error,
        sandboxId,
        timestamp: timestampSeconds(event),
      }
  }
}

export class HarnessContainerProvider implements SandboxProvider {
  readonly name = "ai-sdk-harness-container"
  readonly capabilities = {
    supportsSnapshots: false,
    supportsRestore: false,
    supportsWarm: true,
  } as const

  constructor(private readonly env: Env) {}

  createSandbox(config: CreateSandboxConfig) {
    return this.startRuntime(config)
  }

  warmSandbox(config: CreateSandboxConfig) {
    return this.startRuntime(config)
  }

  destroySandbox(_sessionId: string, sandboxId: string, agentRuntime: AgentRuntime) {
    return Effect.gen({ self: this }, function* () {
      const runtime = harnessRuntime(agentRuntime)
      const stub = agentStub(this.env, runtime, sandboxId)
      yield* Effect.tryPromise({
        try: () =>
          postJson(stub, "/interrupt", {}).then((response) => requireOk(response, "interrupt")),
        catch: toError,
      }).pipe(Effect.catch(() => Effect.void))
    })
  }

  runPrompt(
    sessionId: string,
    sandboxId: string,
    request: PromptRequest,
    onEvent: (event: SandboxEvent) => Promise<void>,
  ) {
    return Effect.gen({ self: this }, function* () {
      const runtime = harnessRuntime(request.agentRuntime)
      const compiledConfig = yield* Effect.tryPromise({
        try: () =>
          compileOpenCodeConfigForModel(this.env, request.author.userId, request.model, {
            mcp: request.mcpServers,
          }),
        catch: toError,
      })
      const model = runtimeProviderConfig({
        runtime,
        providerId: compiledConfig.providerId,
        modelId: compiledConfig.modelId,
        config: compiledConfig.config,
      })
      assertRuntimeProviderCompatibility(runtime, model)
      const skills = yield* Effect.tryPromise({
        try: () =>
          resolveRuntimeSkillPackages({
            db: this.env.DB,
            bucket: this.env.AGENT_SKILLS,
            userId: request.author.userId,
          }),
        catch: toError,
      })

      const stub = agentStub(this.env, runtime, sandboxId)
      const cursor = yield* Effect.tryPromise({
        try: async () => {
          const response = await postJson(stub, "/send", {
            messageId: request.messageId,
            sessionId,
            content: request.content,
            model,
            reasoningEffort: request.reasoningEffort ?? null,
            mcpServers: request.mcpServers ?? {},
            secretEnv: request.secretEnv ?? {},
            skills,
          })
          await requireOk(response, "send prompt")
          const body = (await response.json()) as RuntimeSendResponse
          if (!Number.isInteger(body.cursor) || body.cursor < 0) {
            throw new Error("Agent runtime returned an invalid event cursor")
          }
          return body.cursor
        },
        catch: toError,
      })

      return yield* this.pollPrompt(stub, sandboxId, cursor, onEvent)
    }).pipe(
      Effect.catch((errorValue) => this.emitPromptFailure(errorValue, request, sandboxId, onEvent)),
    )
  }

  syncRuntimeConfig(_sessionId: string, _sandboxId: string, _config: RuntimeConfigInput) {
    return Effect.void
  }

  stopPrompt(_sessionId: string, sandboxId: string, agentRuntime: AgentRuntime) {
    return Effect.gen({ self: this }, function* () {
      const runtime = harnessRuntime(agentRuntime)
      const stub = agentStub(this.env, runtime, sandboxId)
      yield* Effect.tryPromise({
        try: () =>
          postJson(stub, "/interrupt", {}).then((response) => requireOk(response, "interrupt")),
        catch: toError,
      })
    })
  }

  private startRuntime(config: CreateSandboxConfig) {
    return Effect.gen({ self: this }, function* () {
      const runtime = runtimeForConfig(config)
      const stub = agentStub(this.env, runtime, config.sandboxId)
      yield* Effect.tryPromise({
        try: () =>
          postJson(stub, "/init", {
            sessionId: config.sessionId,
            repoOwner: config.repoOwner ?? null,
            repoName: config.repoName ?? null,
            repoDefaultBranch: config.repoDefaultBranch ?? null,
            branchName: config.branchName ?? null,
            githubAccessToken: config.githubAccessToken ?? null,
            githubLogin: config.githubLogin ?? null,
            githubName: config.githubName ?? null,
            githubEmail: config.githubEmail ?? null,
            secretEnv: config.secretEnv ?? {},
          }).then((response) => requireOk(response, "initialize agent runtime")),
        catch: toError,
      })
      return {
        sandboxId: config.sandboxId,
        status: "ready" as const,
        createdAt: Date.now(),
      }
    })
  }

  private pollPrompt(
    stub: DurableObjectStub,
    sandboxId: string,
    initialCursor: number,
    onEvent: (event: SandboxEvent) => Promise<void>,
  ) {
    return Effect.gen(function* () {
      let cursor = initialCursor
      const state: RuntimeSessionState = {
        text: "",
        reasoningById: new Map(),
      }
      for (;;) {
        const payload = yield* Effect.tryPromise({
          try: async () => {
            const response = await fetchContainer(stub, `/poll?cursor=${cursor}`)
            await requireOk(response, "poll events")
            return (await response.json()) as RuntimePollResponse
          },
          catch: toError,
        })
        cursor = payload.cursor
        for (const runtimeEvent of payload.events) {
          const event = mapRuntimeEvent(runtimeEvent, sandboxId, state)
          if (event) {
            yield* Effect.tryPromise({ try: () => onEvent(event), catch: toError })
          }
          if (runtimeEvent.type === "finish") {
            return { success: runtimeEvent.success, error: runtimeEvent.error }
          }
        }
        yield* Effect.sleep("500 millis")
      }
    })
  }

  private emitPromptFailure(
    errorValue: unknown,
    request: PromptRequest,
    sandboxId: string,
    onEvent: (event: SandboxEvent) => Promise<void>,
  ) {
    const error = errorValue instanceof Error ? errorValue.message : String(errorValue)
    return Effect.gen(function* () {
      yield* Effect.tryPromise({
        try: () =>
          onEvent({
            type: "error",
            error,
            messageId: request.messageId,
            sandboxId,
            timestamp: Date.now() / 1000,
          }),
        catch: toError,
      })
      yield* Effect.tryPromise({
        try: () =>
          onEvent({
            type: "execution_complete",
            messageId: request.messageId,
            success: false,
            error,
            sandboxId,
            timestamp: Date.now() / 1000,
          }),
        catch: toError,
      })
      return { success: false, error }
    })
  }
}
