import {
  humanizeCloudflareAiGatewayError,
  resolveAgentRuntime,
  type AgentRuntime,
  type CompiledOpenCodeConfig,
} from "@solzero/shared"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as P from "effect/Predicate"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import { toError } from "../../../lib/effect-errors"
import { stringifyJson } from "../../../lib/json"
import { compileOpenCodeConfigForModel } from "../../provider-catalog"
import { makeControlPlaneFromEnv } from "../../../effect/db/control-plane-db"
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
      providerId: "litellm" | "cloudflare-ai-gateway"
      modelId: string
      auth: {
        apiKey: string
        baseUrl: string
        name: string
        modelProviderName: string
      }
    }
  | {
      kind: "openai-responses"
      providerId: "cloudflare-ai-gateway"
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
      providerId: "litellm-anthropic" | "cloudflare-ai-gateway"
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

class HarnessRuntimeError extends Schema.TaggedError<HarnessRuntimeError>()(
  "HarnessRuntimeError",
  { message: Schema.String },
) {}

function harnessRuntime(agentRuntime: AgentRuntime): AgentContainerRuntime {
  return Match.value(agentRuntime).pipe(
    Match.when("isolate", () => {
      throw new Error("Harness container provider cannot run isolate sessions")
    }),
    Match.orElse((runtime) => runtime),
  )
}

function runtimeForConfig(config: CreateSandboxConfig | { agentRuntime?: AgentRuntime | null }) {
  return harnessRuntime(
    resolveAgentRuntime({
      agentRuntime: config.agentRuntime,
      sessionKind: "sandbox",
    }),
  )
}

function namespaceForRuntime(env: Env, runtime: AgentContainerRuntime): DurableObjectNamespace {
  const binding = Match.value(runtime).pipe(
    Match.when("opencode", () => env.OPENCODE_AGENT),
    Match.when("codex", () => env.CODEX_AGENT),
    Match.when("claude-code", () => env.CLAUDE_CODE_AGENT),
    Match.exhaustive,
  )

  return Option.getOrThrowWith(
    Option.fromNullishOr(binding),
    () => new Error(`Agent runtime '${runtime}' is not bound to the API Worker`),
  )
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
    body: stringifyJson(body),
  })
}

async function requireOk(response: Response, action: string): Promise<void> {
  return Match.value(response.ok).pipe(
    Match.when(true, () => Promise.resolve()),
    Match.orElse(() =>
      response
        .text()
        .catch(() => "")
        .then((body) =>
          Promise.reject(new Error(`${action} failed (${response.status}): ${body}`)),
        ),
    ),
  )
}

/** Fails like requireOk on a non-2xx response, then reads the JSON body. */
async function readOkJson(response: Response, action: string): Promise<unknown> {
  return requireOk(response, action).then(() => response.json())
}

function requireProviderOption(
  config: CompiledOpenCodeConfig,
  providerId: string,
  optionName: string,
): string {
  return Option.getOrThrowWith(
    Option.liftPredicate(
      config.provider[providerId]?.options?.[optionName],
      (value): value is string => typeof value === "string" && value.length > 0,
    ),
    () => new Error(`Provider '${providerId}' is missing '${optionName}'`),
  )
}

function runtimeProviderConfig(input: {
  runtime: AgentContainerRuntime
  providerId: string
  modelId: string
  config: CompiledOpenCodeConfig
}): RuntimeProviderConfig {
  const apiKey = requireProviderOption(input.config, input.providerId, "apiKey")
  const baseUrl = requireProviderOption(input.config, input.providerId, "baseURL")

  const providerApi =
    input.config.provider[input.providerId]?.models?.[input.modelId]?.provider?.api

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
    Match.when("cloudflare-ai-gateway", () =>
      Match.value(providerApi).pipe(
        Match.when("responses", () => ({
          kind: "openai-responses" as const,
          providerId: "cloudflare-ai-gateway" as const,
          modelId: input.modelId,
          auth: {
            apiKey,
            baseUrl,
            name: "cloudflare-ai-gateway",
            modelProviderName: "cloudflare-ai-gateway",
          },
        })),
        Match.when("chat_completions", () => ({
          kind: "openai-compatible" as const,
          providerId: "cloudflare-ai-gateway" as const,
          modelId: input.modelId,
          auth: {
            apiKey,
            baseUrl,
            name: "cloudflare-ai-gateway",
            modelProviderName: "cloudflare-ai-gateway",
          },
        })),
        Match.when("messages", () => ({
          kind: "anthropic" as const,
          providerId: "cloudflare-ai-gateway" as const,
          modelId: input.modelId,
          auth: { apiKey, baseUrl },
        })),
        Match.orElse(() => {
          throw new Error(
            `Cloudflare AI Gateway model '${input.modelId}' must declare provider.api as responses, chat_completions, or messages`,
          )
        }),
      ),
    ),
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
    Match.when(
      "codex",
      () =>
        provider.kind === "openai-responses" ||
        (provider.kind === "openai-compatible" && provider.providerId === "litellm"),
    ),
    Match.when("claude-code", () => provider.kind === "anthropic"),
    Match.exhaustive,
  )

  Match.value(ok).pipe(
    Match.when(true, () => undefined),
    Match.orElse(() => {
      throw new Error(
        `Model '${provider.providerId}/${provider.modelId}' is not compatible with ${runtime}`,
      )
    }),
  )
}

function timestampSeconds(event: { timestamp: number }): number {
  return event.timestamp / 1000
}

function stringifyOutput(value: unknown): string {
  return Match.value(value).pipe(
    Match.when(Match.string, (text) => text),
    Match.orElse((other) =>
      Result.getOrElse(
        Result.try(() => JSON.stringify(other)),
        () => String(other),
      ),
    ),
  )
}

type RuntimeEventOf<T extends RuntimeEvent["type"]> = Extract<RuntimeEvent, { type: T }>

function textDeltaEvent(
  event: RuntimeEventOf<"text-delta">,
  sandboxId: string,
  state: RuntimeSessionState,
): SandboxEvent {
  state.text += event.text

  return {
    type: "token",
    content: state.text,
    messageId: event.messageId,
    sandboxId,
    timestamp: timestampSeconds(event),
  }
}

function reasoningDeltaEvent(
  event: RuntimeEventOf<"reasoning-delta">,
  sandboxId: string,
  state: RuntimeSessionState,
): SandboxEvent {
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

function toolCallArgs(input: unknown): Record<string, unknown> {
  return Option.match(Option.liftPredicate(input, P.isObjectOrArray), {
    // SAFETY: the input is a non-null object, so it is read as a string-keyed record.
    onSome: (record) => record as Record<string, unknown>,
    onNone: () => ({ input }),
  })
}

/** Maps one container event. Event types this Worker does not know map to `None`. */
export function mapRuntimeEvent(
  event: RuntimeEvent,
  sandboxId: string,
  state: RuntimeSessionState,
): Option.Option<SandboxEvent> {
  return Match.value(event).pipe(
    Match.when({ type: "text-delta" }, (delta) =>
      Option.some(textDeltaEvent(delta, sandboxId, state)),
    ),
    Match.when({ type: "reasoning-delta" }, (delta) =>
      Option.some(reasoningDeltaEvent(delta, sandboxId, state)),
    ),
    Match.when({ type: "tool-call" }, (call) =>
      Option.some<SandboxEvent>({
        type: "tool_call",
        messageId: call.messageId,
        sandboxId,
        tool: call.toolName,
        args: toolCallArgs(call.input),
        callId: call.toolCallId,
        timestamp: timestampSeconds(call),
      }),
    ),
    Match.when({ type: "tool-result" }, (result) =>
      Option.some<SandboxEvent>({
        type: "tool_result",
        messageId: result.messageId,
        sandboxId,
        tool: result.toolName ?? "tool",
        result: stringifyOutput(result.output),
        callId: result.toolCallId,
        success: result.isError !== true,
        timestamp: timestampSeconds(result),
      }),
    ),
    Match.when({ type: "file-change" }, (change) =>
      Option.some<SandboxEvent>({
        type: "tool_call",
        messageId: change.messageId,
        sandboxId,
        tool: "file_change",
        args: { event: change.event, path: change.path },
        callId: `file-change:${change.path}:${change.timestamp}`,
        timestamp: timestampSeconds(change),
      }),
    ),
    Match.when({ type: "error" }, (failure) =>
      Option.some<SandboxEvent>({
        type: "error",
        messageId: failure.messageId,
        sandboxId,
        error: humanizeCloudflareAiGatewayError(failure.error),
        timestamp: timestampSeconds(failure),
      }),
    ),
    Match.when({ type: "finish" }, (finish) =>
      Option.some<SandboxEvent>({
        type: "execution_complete",
        messageId: finish.messageId,
        success: finish.success,
        error: Option.fromNullishOr(finish.error).pipe(
          Option.filter((error) => error.length > 0),
          Option.map(humanizeCloudflareAiGatewayError),
          Option.getOrElse(() => finish.error),
        ),
        sandboxId,
        timestamp: timestampSeconds(finish),
      }),
    ),
    Match.orElse(() => Option.none()),
  )
}

const isFinishEvent = (event: RuntimeEvent): event is RuntimeEventOf<"finish"> =>
  event.type === "finish"

interface PollOutcome {
  readonly finished: boolean
  readonly success: boolean
  readonly error?: string
}

const PENDING_POLL: PollOutcome = { finished: false, success: false }

/** The events up to and including the first finish event. Later events in the batch are dropped. */
function eventsThroughFinish(events: readonly RuntimeEvent[]): readonly RuntimeEvent[] {
  return Option.match(Arr.findFirstIndex(events, isFinishEvent), {
    onNone: () => events,
    onSome: (index) => events.slice(0, index + 1),
  })
}

function pollOutcome(events: readonly RuntimeEvent[]): PollOutcome {
  return Option.match(Arr.findFirst(events, isFinishEvent), {
    onNone: () => PENDING_POLL,
    onSome: (finish) => ({ finished: true, success: finish.success, error: finish.error }),
  })
}

function validCursor(cursor: number) {
  return Effect.fromResult(
    Result.liftPredicate(
      cursor,
      (value) => Number.isInteger(value) && value >= 0,
      () => new HarnessRuntimeError({ message: "Agent runtime returned an invalid event cursor" }),
    ),
  )
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
            brandName: this.env.S0_BRAND_NAME,
            createPullRequestCommand: this.env.S0_CREATE_PR_COMMAND,
            db: makeControlPlaneFromEnv(this.env),
            bucket: this.env.AGENT_SKILLS,
            userId: request.author.userId,
          }),
        catch: toError,
      })

      const stub = agentStub(this.env, runtime, sandboxId)

      const sent = yield* Effect.tryPromise({
        try: () =>
          postJson(stub, "/send", {
            messageId: request.messageId,
            sessionId,
            content: request.content,
            model,
            reasoningEffort: request.reasoningEffort ?? null,
            mcpServers: request.mcpServers ?? {},
            secretEnv: request.secretEnv ?? {},
            skills,
          }).then((response) => readOkJson(response, "send prompt")),
        catch: toError,
      })

      // SAFETY: The JSON body is the RuntimeSendResponse shape read by this caller after the response arrives.
      const cursor = yield* validCursor((sent as RuntimeSendResponse).cursor)

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
            brandName: this.env.S0_BRAND_NAME,
            createPullRequestCommand: this.env.S0_CREATE_PR_COMMAND,
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
      let outcome = PENDING_POLL

      const state: RuntimeSessionState = {
        text: "",
        reasoningById: new Map(),
      }

      const pause = Effect.sleep("500 millis")

      const deliver = (runtimeEvent: RuntimeEvent) =>
        Option.match(mapRuntimeEvent(runtimeEvent, sandboxId, state), {
          onNone: () => Effect.void,
          onSome: (event) => Effect.tryPromise({ try: () => onEvent(event), catch: toError }),
        })

      while (!outcome.finished) {
        const polled = yield* Effect.tryPromise({
          try: () =>
            fetchContainer(stub, `/poll?cursor=${cursor}`).then((response) =>
              readOkJson(response, "poll events"),
            ),
          catch: toError,
        })

        // SAFETY: The JSON body is the RuntimePollResponse shape read by this caller after the response arrives.
        const payload = polled as RuntimePollResponse
        cursor = payload.cursor

        yield* Effect.forEach(eventsThroughFinish(payload.events), deliver, { discard: true })
        outcome = pollOutcome(payload.events)
        const stillPolling = Effect.succeed(!outcome.finished)
        yield* Effect.when(pause, stillPolling)
      }

      return { success: outcome.success, error: outcome.error }
    })
  }

  private emitPromptFailure(
    errorValue: unknown,
    request: PromptRequest,
    sandboxId: string,
    onEvent: (event: SandboxEvent) => Promise<void>,
  ) {
    const error = Match.value(errorValue).pipe(
      Match.when(Match.instanceOf(Error), (failure) => failure.message),
      Match.orElse((other) => String(other)),
    )

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
