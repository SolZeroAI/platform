import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as P from "effect/Predicate"

type JsonObject = Record<string, unknown>

type FunctionNames = Map<string, { name: string; namespace: string }>

interface PreparedWorkersAiRequest {
  request: Request
  streaming: boolean
  functionNames?: FunctionNames
}

type GptOssStreamingBody = JsonObject & { model: string }

type NamespaceTool = JsonObject & { type: "namespace"; name: string; tools: unknown[] }

type FunctionTool = JsonObject & { type: "function"; name: string }

interface ChatTool {
  type: "function"
  function: JsonObject & { name: string }
}

type ChatFunctionCall = JsonObject & {
  id: string
  function: JsonObject & { name: string; arguments: string }
}

interface ChatCompletion {
  completion: JsonObject
  choice: JsonObject
  message: JsonObject
}

type ResponsesValue = JsonObject & { id: string; output: unknown[] }

type EmitEvent = (type: string, fields: JsonObject) => void

const RESPONSES_PATH = /^\/client\/v4\/accounts\/[^/]+\/ai\/v1\/responses$/
const GPT_OSS_MODEL = /^@cf\/openai\/gpt-oss-(20b|120b)$/

function object(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function fail(message: string): never {
  throw new Error(message)
}

function rejectWhen(condition: boolean, message: string): void {
  Match.value(condition).pipe(
    Match.when(true, () => fail(message)),
    Match.orElse(() => undefined),
  )
}

function requireObject(value: unknown, message: string): asserts value is JsonObject {
  rejectWhen(!object(value), message)
}

function describeType(value: unknown): string {
  return Match.value(value).pipe(
    Match.when(object, (item) => String(item.type)),
    Match.orElse(() => "invalid"),
  )
}

function qualifiedName(namespace: unknown, name: unknown): unknown {
  return Match.value(namespace).pipe(
    Match.when(P.isString, (prefix) => `${prefix}__${String(name)}`),
    Match.orElse(() => name),
  )
}

function fieldWhenSome(key: string, value: Option.Option<unknown>): JsonObject {
  return Option.match(value, {
    onNone: () => ({}),
    onSome: (present) => ({ [key]: present }),
  })
}

function isGptOssStreamingBody(value: unknown): value is GptOssStreamingBody {
  return (
    object(value) &&
    typeof value.model === "string" &&
    GPT_OSS_MODEL.test(value.model) &&
    value.stream === true
  )
}

/** Bridge native GPT-OSS through buffered Chat: both Responses endpoints currently mangle flat tools. */
export async function prepareWorkersAiResponses(
  request: Request,
): Promise<PreparedWorkersAiRequest> {
  const url = new URL(request.url)

  const isResponsesPost =
    url.hostname === "api.cloudflare.com" &&
    RESPONSES_PATH.test(url.pathname) &&
    request.method === "POST"

  return Match.value(isResponsesPost).pipe(
    Match.when(true, () => bridgeResponsesRequest(request, url)),
    Match.orElse(() => Promise.resolve({ request, streaming: false })),
  )
}

async function bridgeResponsesRequest(
  request: Request,
  url: URL,
): Promise<PreparedWorkersAiRequest> {
  const body: unknown = await request
    .clone()
    .json()
    .catch(() => undefined)

  return Match.value(body).pipe(
    Match.when(isGptOssStreamingBody, (gptOssBody) =>
      bufferedChatRequest(request, url, gptOssBody),
    ),
    Match.orElse(() => ({ request, streaming: false })),
  )
}

function bufferedChatRequest(
  request: Request,
  url: URL,
  body: GptOssStreamingBody,
): PreparedWorkersAiRequest {
  const headers = new Headers(request.headers)
  headers.delete("content-length")
  headers.set("accept", "application/json")
  const functionNames: FunctionNames = new Map()
  const input = responsesToChat(body, functionNames)
  url.pathname = url.pathname.replace(/\/v1\/responses$/, `/run/${body.model}`)
  const { model: _model, ...nativeInput } = input

  return {
    request: new Request(url, {
      method: request.method,
      signal: request.signal,
      headers,
      body: JSON.stringify(nativeInput),
    }),
    streaming: true,
    functionNames,
  }
}

function isMessageItem(item: JsonObject): item is JsonObject & { role: string } {
  return typeof item.role === "string"
}

function isReasoningItem(item: JsonObject): item is JsonObject & { summary: unknown[] } {
  return item.type === "reasoning" && Array.isArray(item.summary)
}

function chatContentPart(part: unknown): JsonObject {
  requireObject(part, "Workers AI does not support Responses content")

  return Match.value(part.type).pipe(
    Match.whenOr("input_text", "output_text", () => ({ type: "text", text: part.text })),
    Match.when("input_image", () => ({
      type: "image_url",
      image_url: { url: part.image_url, detail: part.detail },
    })),
    Match.orElse((type) => fail(`Workers AI does not support Responses content: ${String(type)}`)),
  )
}

function joinTextParts(parts: JsonObject[]): unknown {
  return Match.value(
    parts.every((part) => part.type === "text" && typeof part.text === "string"),
  ).pipe(
    Match.when(true, () => parts.map((part) => part.text).join("")),
    Match.orElse(() => parts),
  )
}

function chatMessage(item: JsonObject & { role: string }) {
  const content = Match.value(item.content).pipe(
    Match.when(Array.isArray, (parts: unknown[]) => joinTextParts(parts.map(chatContentPart))),
    Match.orElse((value) => value),
  )

  const role = Match.value(item.role).pipe(
    Match.when("developer", () => "system"),
    Match.orElse((value) => value),
  )

  return { role, content }
}

function appendFunctionCall(
  messages: JsonObject[],
  callNames: Map<unknown, unknown>,
  item: JsonObject,
): void {
  const call = {
    id: item.call_id,
    type: "function",
    function: {
      name: qualifiedName(item.namespace, item.name),
      arguments: item.arguments,
    },
  }

  callNames.set(item.call_id, call.function.name)

  Option.fromNullishOr(messages.at(-1)).pipe(
    Option.filter((previous) => previous.role === "assistant"),
    Option.flatMap((previous) => Option.liftPredicate(previous.tool_calls, Array.isArray)),
    Option.match({
      onNone: () => {
        messages.push({ role: "assistant", content: "", tool_calls: [call] })
      },
      onSome: (toolCalls: unknown[]) => {
        toolCalls.push(call)
      },
    }),
  )
}

function chatToolMessage(callNames: Map<unknown, unknown>, item: JsonObject) {
  return {
    role: "tool",
    tool_call_id: item.call_id,
    name: callNames.get(item.call_id),
    content: Match.value(item.output).pipe(
      Match.when(P.isString, (output) => output),
      Match.orElse((output) => JSON.stringify(output)),
    ),
  }
}

// Chat has no equivalent public Responses reasoning-summary replay contract.
function rejectReasoningReplay(item: JsonObject & { summary: unknown[] }): void {
  const summary = item.summary
    .filter(object)
    .map((part) =>
      Match.value(part.text).pipe(
        Match.when(P.isString, (text) => text),
        Match.orElse(() => ""),
      ),
    )
    .join("\n")

  rejectWhen(
    summary.length > 0,
    "Workers AI cannot replay public Responses reasoning summaries through Chat",
  )
  rejectWhen(
    Boolean(item.encrypted_content),
    "Workers AI cannot replay encrypted Responses reasoning",
  )
}

function appendInputItem(
  messages: JsonObject[],
  callNames: Map<unknown, unknown>,
  item: unknown,
): void {
  requireObject(item, "Workers AI does not support Responses input")

  Match.value(item).pipe(
    Match.when(isMessageItem, (message) => {
      messages.push(chatMessage(message))
    }),
    Match.when({ type: "function_call" }, (call) => appendFunctionCall(messages, callNames, call)),
    Match.when({ type: "function_call_output" }, (output) => {
      messages.push(chatToolMessage(callNames, output))
    }),
    Match.when(isReasoningItem, rejectReasoningReplay),
    Match.orElse((other) =>
      fail(`Workers AI does not support Responses item: ${String(other.type)}`),
    ),
  )
}

function isNamespaceTool(value: unknown): value is NamespaceTool {
  return (
    object(value) &&
    value.type === "namespace" &&
    typeof value.name === "string" &&
    Array.isArray(value.tools)
  )
}

function isFunctionTool(value: unknown): value is FunctionTool {
  return object(value) && value.type === "function" && typeof value.name === "string"
}

function chatFunctionTool(tool: FunctionTool): ChatTool {
  const { type: _type, ...definition } = tool

  return { type: "function", function: definition }
}

function qualifiedFunctionTool(
  namespace: string,
  tool: FunctionTool,
  functionNames: FunctionNames,
): ChatTool {
  const qualified = `${namespace}__${tool.name}`
  functionNames.set(qualified, { name: tool.name, namespace })
  const chatTool = chatFunctionTool(tool)

  return { ...chatTool, function: { ...chatTool.function, name: qualified } }
}

function namespacedChatTool(
  namespace: string,
  fn: unknown,
  functionNames: FunctionNames,
): ChatTool {
  return Match.value(fn).pipe(
    Match.when(isFunctionTool, (tool) => qualifiedFunctionTool(namespace, tool, functionNames)),
    Match.orElse((other) =>
      fail(`Workers AI GPT-OSS does not support namespace tool type: ${describeType(other)}`),
    ),
  )
}

function chatTools(tool: unknown, functionNames: FunctionNames): ChatTool[] {
  return Match.value(tool).pipe(
    Match.when(isNamespaceTool, (namespaceTool) =>
      namespaceTool.tools.map((fn) => namespacedChatTool(namespaceTool.name, fn, functionNames)),
    ),
    Match.when(isFunctionTool, (functionTool) => [chatFunctionTool(functionTool)]),
    Match.orElse((other) =>
      fail(`Workers AI GPT-OSS does not support Responses tool type: ${describeType(other)}`),
    ),
  )
}

function chatToolChoice(choice: unknown): unknown {
  return Match.value(choice).pipe(
    Match.when(
      (value: unknown): value is JsonObject => object(value) && value.type === "function",
      (functionChoice) => ({
        type: "function",
        function: { name: qualifiedName(functionChoice.namespace, functionChoice.name) },
      }),
    ),
    Match.orElse((value) => value),
  )
}

function responsesToChat(body: JsonObject, functionNames: FunctionNames) {
  rejectWhen(
    typeof body.previous_response_id === "string" && body.previous_response_id.length > 0,
    "Workers AI Chat requires full history; previous_response_id is unsupported",
  )
  const messages: JsonObject[] = []
  const callNames = new Map<unknown, unknown>()

  Match.value(body.instructions).pipe(
    Match.when(P.isString, (instructions) => {
      messages.push({ role: "system", content: instructions })
    }),
    Match.orElse(() => undefined),
  )

  const input = Match.value(body.input).pipe(
    Match.when(P.isString, (content): unknown[] => [{ role: "user", content }]),
    Match.when(Array.isArray, (items: unknown[]) => items),
    Match.orElse(() => fail("Workers AI GPT-OSS requires explicit Responses input history")),
  )

  for (const item of input) {
    appendInputItem(messages, callNames, item)
  }

  const tools = Option.liftPredicate(body.tools, Array.isArray).pipe(
    Option.map((list: unknown[]) => list.flatMap((tool) => chatTools(tool, functionNames))),
  )

  Option.map(tools, (list) => {
    const names = list.map((tool) => tool.function.name)
    rejectWhen(
      new Set(names).size !== names.length,
      "Workers AI function names collide across namespaces",
    )
  })

  return {
    model: body.model,
    messages,
    stream: false,
    ...fieldWhenSome("tools", tools),
    ...fieldWhenSome(
      "tool_choice",
      Option.liftPredicate(body.tool_choice, Boolean).pipe(Option.map(chatToolChoice)),
    ),
    // Native default is 256, too small for coding-tool JSON and a final response.
    max_tokens: Match.value(body.max_output_tokens).pipe(
      Match.when(P.isNumber, (tokens) => tokens),
      Match.orElse(() => 4096),
    ),
    ...fieldWhenSome("temperature", Option.liftPredicate(body.temperature, P.isNumber)),
    ...fieldWhenSome("top_p", Option.liftPredicate(body.top_p, P.isNumber)),
    ...fieldWhenSome(
      "parallel_tool_calls",
      Option.liftPredicate(body.parallel_tool_calls, P.isBoolean),
    ),
    ...fieldWhenSome(
      "reasoning_effort",
      Option.liftPredicate(body.reasoning, object).pipe(
        Option.map((reasoning) => reasoning.effort),
        Option.filter(P.isString),
      ),
    ),
  }
}

function chatCompletion(value: unknown): Option.Option<ChatCompletion> {
  return Option.liftPredicate(value, object).pipe(
    Option.flatMap((completion) =>
      Option.liftPredicate(completion.choices, Array.isArray).pipe(
        Option.flatMap((choices: unknown[]) => Option.liftPredicate(choices[0], object)),
        Option.flatMap((choice) =>
          Option.liftPredicate(choice.message, object).pipe(
            Option.map((message) => ({ completion, choice, message })),
          ),
        ),
      ),
    ),
  )
}

function isChatFunctionCall(value: unknown): value is ChatFunctionCall {
  return (
    object(value) &&
    typeof value.id === "string" &&
    object(value.function) &&
    typeof value.function.name === "string" &&
    typeof value.function.arguments === "string"
  )
}

function responsesFunctionCall(call: ChatFunctionCall, functionNames: FunctionNames) {
  const native = Option.fromNullishOr(functionNames.get(call.function.name))

  const name = Option.match(native, {
    onNone: () => call.function.name,
    onSome: (entry) => entry.name,
  })

  const namespace = fieldWhenSome(
    "namespace",
    Option.map(native, (entry) => entry.namespace),
  )

  return {
    id: call.id,
    call_id: call.id,
    type: "function_call",
    status: "completed",
    name,
    ...namespace,
    arguments: call.function.arguments,
  }
}

function responsesMessageOutput(id: unknown, content: unknown): JsonObject[] {
  return Option.liftPredicate(
    content,
    (text: unknown): text is string => typeof text === "string" && text.length > 0,
  ).pipe(
    Option.match({
      onNone: () => [],
      onSome: (text) => [
        {
          id: `${String(id)}_message`,
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text, annotations: [] }],
        },
      ],
    }),
  )
}

function responsesFunctionCalls(toolCalls: unknown, functionNames: FunctionNames): JsonObject[] {
  return Option.liftPredicate(toolCalls, Array.isArray).pipe(
    Option.map((calls: unknown[]) =>
      calls.map((call) =>
        Match.value(call).pipe(
          Match.when(isChatFunctionCall, (functionCall) =>
            responsesFunctionCall(functionCall, functionNames),
          ),
          Match.orElse(() => fail("Invalid Workers AI function response")),
        ),
      ),
    ),
    Option.getOrElse((): JsonObject[] => []),
  )
}

function tokenDetail(details: unknown, key: string): unknown {
  return Option.liftPredicate(details, object).pipe(
    Option.flatMap((detail) => Option.fromNullishOr(detail[key])),
    Option.getOrElse(() => 0),
  )
}

function responsesUsage(usage: JsonObject) {
  return {
    input_tokens: usage.prompt_tokens,
    output_tokens: usage.completion_tokens,
    total_tokens: usage.total_tokens,
    input_tokens_details: {
      cached_tokens: tokenDetail(usage.prompt_tokens_details, "cached_tokens"),
    },
    output_tokens_details: {
      reasoning_tokens: tokenDetail(usage.completion_tokens_details, "reasoning_tokens"),
    },
  }
}

function responsesFinish(reason: unknown): JsonObject {
  return Match.value(reason).pipe(
    Match.when("length", () => ({
      status: "incomplete",
      error: null,
      incomplete_details: { reason: "max_output_tokens" },
    })),
    Match.whenOr("stop", "tool_calls", () => ({
      status: "completed",
      error: null,
      incomplete_details: null,
    })),
    Match.orElse((other) => ({
      status: "failed",
      error: {
        code: String(other),
        message: `Workers AI terminated generation: ${String(other)}`,
      },
      incomplete_details: null,
    })),
  )
}

function responsesFromChat(
  { completion, choice, message }: ChatCompletion,
  functionNames: FunctionNames,
) {
  // Provider-private reasoning is not a public Responses summary.
  const output = [
    ...responsesMessageOutput(completion.id, message.content),
    ...responsesFunctionCalls(message.tool_calls, functionNames),
  ]

  return {
    id: completion.id,
    object: "response",
    created_at: completion.created,
    model: completion.model,
    output,
    usage: Option.liftPredicate(completion.usage, object).pipe(
      Option.map(responsesUsage),
      Option.getOrNull,
    ),
    ...responsesFinish(choice.finish_reason),
  }
}

function chatToResponses(value: unknown, functionNames: FunctionNames): unknown {
  return Option.match(chatCompletion(value), {
    onNone: () => value,
    onSome: (completion) => responsesFromChat(completion, functionNames),
  })
}

function isResponsesValue(value: unknown): value is ResponsesValue {
  return object(value) && typeof value.id === "string" && Array.isArray(value.output)
}

function emitReasoningSummary(
  emit: EmitEvent,
  common: JsonObject,
  item: JsonObject & { summary: unknown[] },
): void {
  for (const [summaryIndex, part] of item.summary.entries()) {
    Option.liftPredicate(
      part,
      (value: unknown): value is JsonObject & { text: string } =>
        object(value) && typeof value.text === "string",
    ).pipe(
      Option.map((summaryPart) => {
        const summary = { ...common, summary_index: summaryIndex }
        emit("response.reasoning_summary_part.added", {
          ...summary,
          part: { ...summaryPart, text: "" },
        })
        emit("response.reasoning_summary_text.delta", { ...summary, delta: summaryPart.text })
        emit("response.reasoning_summary_text.done", { ...summary, text: summaryPart.text })
        emit("response.reasoning_summary_part.done", { ...summary, part: summaryPart })
      }),
    )
  }
}

function emitContentParts(emit: EmitEvent, common: JsonObject, parts: unknown[]): void {
  for (const [contentIndex, part] of parts.entries()) {
    Option.liftPredicate(part, object).pipe(
      Option.map((contentPart) => {
        const content = { ...common, content_index: contentIndex }
        const isOutputText = contentPart.type === "output_text"
        emit("response.content_part.added", {
          ...content,
          part: {
            ...contentPart,
            ...Match.value(isOutputText).pipe(
              Match.when(true, () => ({ text: "" })),
              Match.orElse(() => ({})),
            ),
          },
        })

        Option.liftPredicate(contentPart.text, P.isString).pipe(
          Option.filter(() => isOutputText),
          Option.map((text) => {
            emit("response.output_text.delta", { ...content, delta: text })
            emit("response.output_text.done", { ...content, text })
          }),
        )
        emit("response.content_part.done", { ...content, part: contentPart })
      }),
    )
  }
}

function emitOutputItem(emit: EmitEvent, outputIndex: number, item: JsonObject): void {
  const common = { output_index: outputIndex, item_id: item.id }
  emit("response.output_item.added", {
    output_index: outputIndex,
    item: {
      ...item,
      status: "in_progress",
      ...Match.value(item.type).pipe(
        Match.when("function_call", () => ({ arguments: "" })),
        Match.orElse(() => ({ content: [] })),
      ),
    },
  })

  Option.liftPredicate(item.arguments, P.isString).pipe(
    Option.filter(() => item.type === "function_call"),
    Option.map((args) => {
      emit("response.function_call_arguments.delta", { ...common, delta: args })
      emit("response.function_call_arguments.done", {
        ...common,
        arguments: args,
        name: item.name,
      })
    }),
  )

  Option.liftPredicate(item, isReasoningItem).pipe(
    Option.map((reasoning) => emitReasoningSummary(emit, common, reasoning)),
  )

  Option.liftPredicate(item.content, Array.isArray).pipe(
    Option.map((parts: unknown[]) => emitContentParts(emit, common, parts)),
  )

  emit("response.output_item.done", { output_index: outputIndex, item })
}

function responsesEvents(value: ResponsesValue): string[] {
  const events: string[] = []
  let sequence = 0

  const emit: EmitEvent = (type, fields) => {
    events.push(
      `event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: sequence++, ...fields })}\n\n`,
    )
  }

  emit("response.created", { response: { ...value, status: "in_progress", output: [] } })
  emit("response.in_progress", { response: { ...value, status: "in_progress", output: [] } })

  for (const [outputIndex, item] of value.output.entries()) {
    Option.liftPredicate(item, object).pipe(
      Option.map((outputItem) => emitOutputItem(emit, outputIndex, outputItem)),
    )
  }

  const terminal = Match.value(value.status).pipe(
    Match.when("failed", () => "failed"),
    Match.when("incomplete", () => "incomplete"),
    Match.orElse(() => "completed"),
  )

  emit(`response.${terminal}`, { response: value })

  return events
}

function eventStreamResponse(response: Response, value: ResponsesValue): Response {
  const events = responsesEvents(value)
  const headers = new Headers(response.headers)
  headers.set("content-type", "text/event-stream; charset=utf-8")
  headers.delete("content-length")
  headers.delete("content-encoding")

  return new Response(events.join(""), {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

async function replayBufferedResponse(
  response: Response,
  functionNames: FunctionNames,
): Promise<Response> {
  const envelope: unknown = await response
    .clone()
    .json()
    .catch(() => undefined)

  const result = Option.liftPredicate(envelope, object).pipe(
    Option.map((wrapper) => wrapper.result),
    Option.filter(object),
    Option.getOrElse((): unknown => envelope),
  )

  return Match.value(chatToResponses(result, functionNames)).pipe(
    Match.when(isResponsesValue, (value) => eventStreamResponse(response, value)),
    Match.orElse(() => response),
  )
}

/** Replays actual buffered output as Responses events; never synthesizes model content. */
export async function streamWorkersAiResponse(
  response: Response,
  functionNames: FunctionNames = new Map(),
): Promise<Response> {
  return Match.value(response.ok).pipe(
    Match.when(true, () => replayBufferedResponse(response, functionNames)),
    Match.orElse(() => Promise.resolve(response)),
  )
}
