import type { LanguageModel } from "ai"
import * as Arr from "effect/Array"
import * as Context from "effect/Context"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import type { ApiEnv } from "infra/types/env"
import { createWorkersAI } from "workers-ai-provider"

/** The deployment's Cloudflare AI Gateway, as the isolate and container runtimes reach it. */
export interface AiGatewayService {
  /** A Workers AI model that runs through the gateway. */
  readonly workersAi: (modelId: string) => LanguageModel
  /** Sends an authenticated AI Gateway or Workers AI REST request. */
  readonly fetch: typeof fetch
}

export class AiGateway extends Context.Service<AiGateway, AiGatewayService>()("s0/api/AiGateway") {}

function requireAiGatewayBinding(env: ApiEnv): Ai {
  return Option.getOrThrowWith(
    Option.fromNullishOr(env.AI_GATEWAY),
    () => new Error("Cloudflare AI Gateway is enabled but the AI_GATEWAY binding is missing"),
  )
}

function requireAiGatewayId(env: ApiEnv): string {
  return Option.getOrThrowWith(
    Option.fromNullishOr(env.AI_GATEWAY_ID).pipe(
      Option.filter((gatewayId) => gatewayId.trim().length > 0),
    ),
    () => new Error("Cloudflare AI Gateway is enabled but AI_GATEWAY_ID is missing"),
  )
}

function liveAiGateway(env: ApiEnv): AiGatewayService {
  return {
    workersAi: (modelId) =>
      createWorkersAI({
        binding: requireAiGatewayBinding(env),
        gateway: { id: requireAiGatewayId(env) },
      })(modelId),
    // oxlint-disable-next-line effect/avoid-native-fetch -- The AI SDK and container outbound hooks need a Promise fetch at the AI Gateway boundary.
    fetch: (input, init) => fetch(input, init),
  }
}

// oxlint-disable-next-line effect/prefer-schema-class -- A text part of an untrusted Workers AI chat message.
const WorkersAiTextPart = Schema.Struct({ text: Schema.optional(Schema.String) })

// oxlint-disable-next-line effect/prefer-schema-class -- One untrusted Workers AI chat message.
const WorkersAiMessage = Schema.Struct({
  role: Schema.String,
  content: Schema.optional(
    Schema.NullOr(Schema.Union([Schema.String, Schema.Array(WorkersAiTextPart)])),
  ),
})

// oxlint-disable-next-line effect/prefer-schema-class -- Decodes only the chat messages of an untrusted Workers AI request.
const WorkersAiRunInput = Schema.Struct({ messages: Schema.Array(WorkersAiMessage) })

type WorkersAiMessageContent = (typeof WorkersAiMessage.Type)["content"]

function messageText(content: WorkersAiMessageContent): string {
  return Match.value(content).pipe(
    Match.when(Match.string, (text) => text),
    Match.when(Match.null, () => ""),
    Match.when(Match.undefined, () => ""),
    Match.orElse((parts) => parts.map((part) => part.text ?? "").join("")),
  )
}

async function lastUserMessage(request: Request): Promise<string> {
  const body: unknown = await request.json().catch(() => undefined)

  return Schema.decodeUnknownOption(WorkersAiRunInput)(body).pipe(
    Option.flatMap(({ messages }) => Arr.findLast(messages, (message) => message.role === "user")),
    Option.map(({ content }) => messageText(content)),
    Option.getOrElse(() => ""),
  )
}

/**
 * Answers a Workers AI run request with the last user message, in the OpenAI chat shape
 * Workers AI returns for chat models. It reads no prompt instructions and calls no tools.
 */
async function mockAiGatewayFetch(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): Promise<Response> {
  const request = new Request(input, init)
  const path = new URL(request.url).pathname

  return Match.value(/\/ai\/run\//.test(path)).pipe(
    Match.when(false, () =>
      Response.json(
        { success: false, errors: [{ message: `The mock AI Gateway does not serve ${path}` }] },
        { status: 501 },
      ),
    ),
    Match.orElse(async () =>
      Response.json({
        success: true,
        result: {
          id: `chatcmpl-mock-${crypto.randomUUID()}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: "mock",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: await lastUserMessage(request) },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        },
      }),
    ),
  )
}

const mockAiGateway: AiGatewayService = {
  workersAi: createWorkersAI({ accountId: "mock", apiKey: "mock", fetch: mockAiGatewayFetch }),
  fetch: mockAiGatewayFetch,
}

/** Selects the gateway from the stage's `aiGatewayLayer` config. */
export function aiGatewayForEnv(env: ApiEnv): AiGatewayService {
  return Match.value(env.S0_AI_GATEWAY_LAYER).pipe(
    Match.when("mock", () => mockAiGateway),
    Match.orElse(() => liveAiGateway(env)),
  )
}

export function aiGatewayLayer(env: ApiEnv) {
  return Layer.succeed(AiGateway, aiGatewayForEnv(env))
}
