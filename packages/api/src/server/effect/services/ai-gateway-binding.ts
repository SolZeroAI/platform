/* oxlint-disable s0-lint/no-if-statement, s0-lint/no-return-in-arrow, s0-lint/no-return-in-callback, s0-lint/no-ternary, s0-lint/prefer-option-over-null -- This adapter copies the Workers AI binding response shapes (text, tool calls, and SSE) at the provider boundary. */

import type { ApiEnv } from "infra/types/env"
import * as Context from "effect/Context"
import * as Match from "effect/Match"
import * as Option from "effect/Option"

const MOCK_TEXT = "hello"
const MOCK_DELEGATE_TOOL = "delegate_to_subagent"

type MockTurn =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "tool"; readonly name: string; readonly arguments: string }

interface GatewayRunRequest {
  readonly endpoint?: string
  readonly query?: unknown
}

const usage = {
  prompt_tokens: 1,
  completion_tokens: 1,
  total_tokens: 2,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function messageText(message: Record<string, unknown>): string {
  if (typeof message.content === "string") return message.content

  if (typeof message.text === "string") return message.text

  if (typeof message.output === "string") return message.output

  return JSON.stringify(message.content ?? message.text ?? "")
}

function userParts(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((message) => {
    if (!isRecord(message)) return []

    if (message.role === "user" || message.type === "input_text") return [messageText(message)]

    return []
  })
}

function userText(inputs: unknown): string {
  if (!isRecord(inputs)) return ""

  const prompt = typeof inputs.prompt === "string" ? inputs.prompt : ""

  const input = typeof inputs.input === "string" ? inputs.input : ""

  return [...userParts(inputs.messages), ...userParts(inputs.input), input, prompt]
    .filter((part) => part.length > 0)
    .join("\n")
}

function hasToolResult(inputs: unknown): boolean {
  if (!isRecord(inputs)) return false

  return [inputs.messages, inputs.input].some(
    (value) =>
      Array.isArray(value) &&
      value.some(
        (message) =>
          isRecord(message) && (message.role === "tool" || message.type === "function_call_output"),
      ),
  )
}

function mockTurn(inputs: unknown): MockTurn {
  const user = userText(inputs)

  const marker = user.match(/marker[:\s]+([A-Za-z0-9_-]+)/)?.[1]

  const explicitMarker = user.match(/Reply with only this marker:\s*([A-Za-z0-9_-]+)/)?.[1]

  const delegate =
    user.includes(MOCK_DELEGATE_TOOL) && !hasToolResult(inputs) && marker !== undefined

  return Match.value(delegate).pipe(
    Match.when(true, () => ({
      kind: "tool" as const,
      name: MOCK_DELEGATE_TOOL,
      arguments: JSON.stringify({ task: `return the marker ${marker}` }),
    })),
    Match.orElse(() => ({ kind: "text" as const, text: explicitMarker ?? marker ?? MOCK_TEXT })),
  )
}

function toolCall(turn: Extract<MockTurn, { kind: "tool" }>) {
  return {
    id: "call_mock_delegate",
    index: 0,
    type: "function",
    function: { name: turn.name, arguments: turn.arguments },
  }
}

function generation(turn: MockTurn) {
  return Match.value(turn).pipe(
    Match.when({ kind: "tool" }, (toolTurn) => ({
      response: "",
      tool_calls: [toolCall(toolTurn)],
      usage,
    })),
    Match.orElse((textTurn) => ({ response: textTurn.text, usage })),
  )
}

function ssePayload(turn: MockTurn): string {
  return Match.value(turn).pipe(
    Match.when({ kind: "tool" }, (toolTurn) => {
      const calls = JSON.stringify({ tool_calls: [toolCall(toolTurn)] })

      const finish = JSON.stringify({ finish_reason: "tool_calls", usage })

      return `data: ${calls}\n\ndata: ${finish}\n\ndata: [DONE]\n\n`
    }),
    Match.orElse((textTurn) => {
      const chunk = JSON.stringify({ response: textTurn.text })

      const finish = JSON.stringify({ finish_reason: "stop", usage })

      return `data: ${chunk}\n\ndata: ${finish}\n\ndata: [DONE]\n\n`
    }),
  )
}

function sseStream(turn: MockTurn): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()

  const payload = ssePayload(turn)

  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(payload))
      controller.close()
    },
  })
}

function chatMessage(turn: MockTurn) {
  return Match.value(turn).pipe(
    Match.when({ kind: "tool" }, (toolTurn) => ({
      role: "assistant",
      content: "",
      tool_calls: [toolCall(toolTurn)],
    })),
    Match.orElse((textTurn) => ({
      role: "assistant",
      content: textTurn.text,
    })),
  )
}

function chatCompletion(turn: MockTurn) {
  const tool = turn.kind === "tool"

  return {
    id: "chatcmpl-mock",
    object: "chat.completion",
    created: 1,
    model: "mock",
    choices: [
      {
        index: 0,
        message: chatMessage(turn),
        finish_reason: tool ? "tool_calls" : "stop",
      },
    ],
    usage,
  }
}

function responsesObject(text: string) {
  return {
    id: "resp_mock",
    object: "response",
    created_at: 1,
    status: "completed",
    output_text: text,
    output: [
      {
        id: "msg_mock",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text, annotations: [] }],
      },
    ],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  }
}

function anthropicMessage(text: string) {
  return {
    id: "msg_mock",
    type: "message",
    role: "assistant",
    model: "mock",
    stop_reason: "end_turn",
    content: [{ type: "text", text }],
    usage: { input_tokens: 1, output_tokens: 1 },
  }
}

function httpBody(endpoint: string, query: unknown) {
  const turn = mockTurn(query)

  return Match.value(endpoint.includes("/messages")).pipe(
    Match.when(true, () => anthropicMessage(turn.kind === "text" ? turn.text : "")),
    Match.orElse(() =>
      Match.value(endpoint.includes("responses") && turn.kind === "text").pipe(
        Match.when(true, () => responsesObject(turn.kind === "text" ? turn.text : "")),
        Match.orElse(() => chatCompletion(turn)),
      ),
    ),
  )
}

function jsonResponse(body: unknown): Response {
  return Response.json(body)
}

const mockGateway = {
  patchLog: async () => undefined,
  getLog: async (): Promise<AiGatewayLog> =>
    Promise.reject(new Error("The mock AI gateway has no logs")),
  getUrl: async () => "https://workers-ai.local/mock",
  run: async (data: GatewayRunRequest | readonly GatewayRunRequest[]) => {
    const request = Array.isArray(data) ? data[0] : data

    return jsonResponse(httpBody(request?.endpoint ?? "", request?.query))
  },
}

const mockAiGatewayBindingValue = {
  aiGatewayLogId: null,
  gateway: () => mockGateway,
  aiSearch() {
    throw new Error("The mock AI binding does not provide AI Search")
  },
  autorag() {
    throw new Error("The mock AI binding does not provide AutoRAG")
  },
  run: async (_model: string, inputs: unknown, options?: { returnRawResponse?: boolean }) => {
    const turn = mockTurn(inputs)

    const streaming = isRecord(inputs) && inputs.stream === true

    return Match.value(options?.returnRawResponse === true).pipe(
      Match.when(true, () => jsonResponse(chatCompletion(turn))),
      Match.orElse(() =>
        Match.value(streaming).pipe(
          Match.when(true, () => sseStream(turn)),
          Match.orElse(() => generation(turn)),
        ),
      ),
    )
  },
  models: async () => [],
  toMarkdown: () => ({}),
}

export const mockAiGatewayBinding =
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- Workers AI declares Ai as an abstract class, so a structural binding is not assignable without crossing unknown.
  /* SAFETY: This object implements run, gateway, models, toMarkdown, aiSearch, and autorag, the Ai binding surface isolate and container calls use. */ mockAiGatewayBindingValue as unknown as Ai

const unavailableAiGatewayBindingValue = {
  aiGatewayLogId: null,
  gateway: () => ({
    patchLog: async () => undefined,
    getLog: async (): Promise<AiGatewayLog> =>
      Promise.reject(new Error("AI gateway binding is missing")),
    getUrl: async () => Promise.reject(new Error("AI gateway binding is missing")),
    run: async () => Promise.reject(new Error("AI gateway binding is missing")),
  }),
  aiSearch() {
    throw new Error("AI gateway binding is missing")
  },
  autorag() {
    throw new Error("AI gateway binding is missing")
  },
  run: async () => Promise.reject(new Error("AI gateway binding is missing")),
  models: async () => Promise.reject(new Error("AI gateway binding is missing")),
  toMarkdown: () => ({}),
}

const unavailableAiGatewayBinding =
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- Workers AI declares Ai as an abstract class, so a structural binding is not assignable without crossing unknown.
  /* SAFETY: This object implements the same Ai binding methods and rejects every call when a live stage has no AI_GATEWAY binding. */ unavailableAiGatewayBindingValue as unknown as Ai

export class AiGatewayBinding extends Context.Service<AiGatewayBinding, Ai>()(
  "s0/api/AiGatewayBinding",
) {}

export function aiGatewayBindingForEnv(env: ApiEnv): Ai {
  return Match.value(env.S0_AI_GATEWAY_LAYER === "mock").pipe(
    Match.when(true, () => mockAiGatewayBinding),
    Match.orElse(() =>
      Option.getOrThrowWith(
        Option.fromNullishOr(env.AI_GATEWAY),
        () => new Error("Cloudflare AI Gateway is enabled but the AI_GATEWAY binding is missing"),
      ),
    ),
  )
}

export function aiGatewayBindingForContext(env: ApiEnv): Ai {
  return Match.value(env.S0_AI_GATEWAY_LAYER === "mock").pipe(
    Match.when(true, () => mockAiGatewayBinding),
    Match.orElse(() =>
      Option.getOrElse(Option.fromNullishOr(env.AI_GATEWAY), () => unavailableAiGatewayBinding),
    ),
  )
}

export async function mockAiGatewayHttpResponse(binding: Ai, request: Request): Promise<Response> {
  const url = new URL(request.url)

  const query = await request
    .clone()
    .json()
    .catch(() => ({}))

  return binding.gateway("mock").run({
    provider: "workers-ai",
    endpoint: url.pathname,
    headers: {},
    query,
  })
}
