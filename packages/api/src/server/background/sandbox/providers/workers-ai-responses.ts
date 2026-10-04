/* oxlint-disable s0-lint/no-if-statement, s0-lint/no-return-in-arrow, s0-lint/no-ternary, s0-lint/prefer-option-over-null -- This HTTP protocol adapter validates untrusted provider JSON at the container fetch boundary. */

type JsonObject = Record<string, unknown>
type FunctionNames = Map<string, { name: string; namespace: string }>
function object(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Bridge native GPT-OSS through buffered Chat: both Responses endpoints currently mangle flat tools. */
export async function prepareWorkersAiResponses(request: Request): Promise<{
  request: Request
  streaming: boolean
  functionNames?: FunctionNames
}> {
  const unchanged = { request, streaming: false }
  const url = new URL(request.url)
  if (
    url.hostname !== "api.cloudflare.com" ||
    !/^\/client\/v4\/accounts\/[^/]+\/ai\/v1\/responses$/.test(url.pathname) ||
    request.method !== "POST"
  )
    return unchanged
  const body: unknown = await request
    .clone()
    .json()
    .catch(() => undefined)
  if (
    !object(body) ||
    typeof body.model !== "string" ||
    !/^@cf\/openai\/gpt-oss-(20b|120b)$/.test(body.model) ||
    body.stream !== true
  )
    return unchanged
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

function responsesToChat(body: JsonObject, functionNames: FunctionNames): JsonObject {
  if (typeof body.previous_response_id === "string" && body.previous_response_id.length)
    throw new Error("Workers AI Chat requires full history; previous_response_id is unsupported")
  const messages: JsonObject[] = []
  const callNames = new Map<unknown, unknown>()
  if (typeof body.instructions === "string")
    messages.push({ role: "system", content: body.instructions })
  const input =
    typeof body.input === "string" ? [{ role: "user", content: body.input }] : body.input
  if (!Array.isArray(input))
    throw new Error("Workers AI GPT-OSS requires explicit Responses input history")
  for (const item of input) {
    if (!object(item)) throw new Error("Workers AI does not support Responses input")
    if (typeof item.role === "string") {
      const content = Array.isArray(item.content)
        ? item.content.map((part: unknown) => {
            if (!object(part)) throw new Error("Workers AI does not support Responses content")
            if (part.type === "input_text" || part.type === "output_text")
              return { type: "text", text: part.text }
            if (part.type === "input_image")
              return { type: "image_url", image_url: { url: part.image_url, detail: part.detail } }
            throw new Error(`Workers AI does not support Responses content: ${String(part.type)}`)
          })
        : item.content
      const text =
        Array.isArray(content) &&
        content.every((part) => part.type === "text" && typeof part.text === "string")
          ? content.map((part) => part.text).join("")
          : content
      messages.push({ role: item.role === "developer" ? "system" : item.role, content: text })
    } else if (item.type === "function_call") {
      const call = {
        id: item.call_id,
        type: "function",
        function: {
          name: typeof item.namespace === "string" ? `${item.namespace}__${item.name}` : item.name,
          arguments: item.arguments,
        },
      }
      callNames.set(item.call_id, call.function.name)
      const previous = messages.at(-1)
      if (previous?.role === "assistant" && Array.isArray(previous.tool_calls))
        previous.tool_calls.push(call)
      else messages.push({ role: "assistant", content: "", tool_calls: [call] })
    } else if (item.type === "function_call_output") {
      messages.push({
        role: "tool",
        tool_call_id: item.call_id,
        name: callNames.get(item.call_id),
        content: typeof item.output === "string" ? item.output : JSON.stringify(item.output),
      })
    } else if (item.type === "reasoning" && Array.isArray(item.summary)) {
      // Chat has no equivalent public Responses reasoning-summary replay contract.
      const summary = item.summary
        .filter(object)
        .map((part) => (typeof part.text === "string" ? part.text : ""))
        .join("\n")
      if (summary)
        throw new Error(
          "Workers AI cannot replay public Responses reasoning summaries through Chat",
        )
      if (item.encrypted_content)
        throw new Error("Workers AI cannot replay encrypted Responses reasoning")
    } else throw new Error(`Workers AI does not support Responses item: ${String(item.type)}`)
  }
  const tools = Array.isArray(body.tools)
    ? body.tools.flatMap((tool: unknown) => {
        if (
          object(tool) &&
          tool.type === "namespace" &&
          typeof tool.name === "string" &&
          Array.isArray(tool.tools)
        ) {
          const namespace = tool.name
          return tool.tools.map((fn: unknown) => {
            if (!object(fn) || fn.type !== "function" || typeof fn.name !== "string")
              throw new Error(
                `Workers AI GPT-OSS does not support namespace tool type: ${object(fn) ? String(fn.type) : "invalid"}`,
              )
            const qualified = `${namespace}__${fn.name}`
            functionNames.set(qualified, { name: fn.name, namespace })
            const { type: _type, ...definition } = fn
            return { type: "function", function: { ...definition, name: qualified } }
          })
        }
        if (!object(tool) || tool.type !== "function" || typeof tool.name !== "string")
          throw new Error(
            `Workers AI GPT-OSS does not support Responses tool type: ${object(tool) ? String(tool.type) : "invalid"}`,
          )
        const { type: _type, ...fn } = tool
        return [{ type: "function", function: fn }]
      })
    : undefined
  const names = tools?.map((tool) => tool.function.name)
  if (names && new Set(names).size !== names.length)
    throw new Error("Workers AI function names collide across namespaces")
  return {
    model: body.model,
    messages,
    stream: false,
    ...(tools ? { tools } : {}),
    ...(body.tool_choice
      ? {
          tool_choice:
            object(body.tool_choice) && body.tool_choice.type === "function"
              ? {
                  type: "function",
                  function: {
                    name:
                      typeof body.tool_choice.namespace === "string"
                        ? `${body.tool_choice.namespace}__${body.tool_choice.name}`
                        : body.tool_choice.name,
                  },
                }
              : body.tool_choice,
        }
      : {}),
    // Native default is 256, too small for coding-tool JSON and a final response.
    max_tokens: typeof body.max_output_tokens === "number" ? body.max_output_tokens : 4096,
    ...(typeof body.temperature === "number" ? { temperature: body.temperature } : {}),
    ...(typeof body.top_p === "number" ? { top_p: body.top_p } : {}),
    ...(typeof body.parallel_tool_calls === "boolean"
      ? { parallel_tool_calls: body.parallel_tool_calls }
      : {}),
    ...(object(body.reasoning) && typeof body.reasoning.effort === "string"
      ? { reasoning_effort: body.reasoning.effort }
      : {}),
  }
}

function chatToResponses(value: unknown, functionNames: FunctionNames): unknown {
  if (
    !object(value) ||
    !Array.isArray(value.choices) ||
    !object(value.choices[0]) ||
    !object(value.choices[0].message)
  )
    return value
  const choice = value.choices[0]
  const message = choice.message as JsonObject
  const output: JsonObject[] = []
  // Provider-private reasoning is not a public Responses summary.
  if (typeof message.content === "string" && message.content.length)
    output.push({
      id: `${value.id}_message`,
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: message.content, annotations: [] }],
    })
  if (Array.isArray(message.tool_calls))
    for (const call of message.tool_calls) {
      if (
        !object(call) ||
        typeof call.id !== "string" ||
        !object(call.function) ||
        typeof call.function.name !== "string" ||
        typeof call.function.arguments !== "string"
      )
        throw new Error("Invalid Workers AI function response")
      output.push({
        id: call.id,
        call_id: call.id,
        type: "function_call",
        status: "completed",
        name:
          typeof call.function.name === "string"
            ? (functionNames.get(call.function.name)?.name ?? call.function.name)
            : call.function.name,
        ...(typeof call.function.name === "string" && functionNames.has(call.function.name)
          ? { namespace: functionNames.get(call.function.name)!.namespace }
          : {}),
        arguments: call.function.arguments,
      })
    }
  const usage = object(value.usage)
    ? {
        input_tokens: value.usage.prompt_tokens,
        output_tokens: value.usage.completion_tokens,
        total_tokens: value.usage.total_tokens,
        input_tokens_details: {
          cached_tokens: object(value.usage.prompt_tokens_details)
            ? (value.usage.prompt_tokens_details.cached_tokens ?? 0)
            : 0,
        },
        output_tokens_details: {
          reasoning_tokens: object(value.usage.completion_tokens_details)
            ? (value.usage.completion_tokens_details.reasoning_tokens ?? 0)
            : 0,
        },
      }
    : null
  return {
    id: value.id,
    object: "response",
    created_at: value.created,
    model: value.model,
    output,
    usage,
    status:
      choice.finish_reason === "length"
        ? "incomplete"
        : choice.finish_reason === "stop" || choice.finish_reason === "tool_calls"
          ? "completed"
          : "failed",
    error:
      choice.finish_reason === "stop" ||
      choice.finish_reason === "tool_calls" ||
      choice.finish_reason === "length"
        ? null
        : {
            code: String(choice.finish_reason),
            message: `Workers AI terminated generation: ${String(choice.finish_reason)}`,
          },
    incomplete_details: choice.finish_reason === "length" ? { reason: "max_output_tokens" } : null,
  }
}

/** Replays actual buffered output as Responses events; never synthesizes model content. */
export async function streamWorkersAiResponse(
  response: Response,
  functionNames: FunctionNames = new Map(),
): Promise<Response> {
  if (!response.ok) return response
  const envelope: unknown = await response
    .clone()
    .json()
    .catch(() => undefined)
  const value = chatToResponses(
    object(envelope) && object(envelope.result) ? envelope.result : envelope,
    functionNames,
  )
  if (!object(value) || typeof value.id !== "string" || !Array.isArray(value.output))
    return response
  const events: string[] = []
  let sequence = 0
  const emit = (type: string, fields: JsonObject) => {
    events.push(
      `event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: sequence++, ...fields })}\n\n`,
    )
  }
  emit("response.created", { response: { ...value, status: "in_progress", output: [] } })
  emit("response.in_progress", { response: { ...value, status: "in_progress", output: [] } })
  for (const [outputIndex, item] of value.output.entries()) {
    if (!object(item)) continue
    const common = { output_index: outputIndex, item_id: item.id }
    emit("response.output_item.added", {
      output_index: outputIndex,
      item: {
        ...item,
        status: "in_progress",
        ...(item.type === "function_call" ? { arguments: "" } : { content: [] }),
      },
    })
    if (item.type === "function_call" && typeof item.arguments === "string") {
      emit("response.function_call_arguments.delta", { ...common, delta: item.arguments })
      emit("response.function_call_arguments.done", {
        ...common,
        arguments: item.arguments,
        name: item.name,
      })
    }
    if (item.type === "reasoning" && Array.isArray(item.summary))
      for (const [summaryIndex, part] of item.summary.entries()) {
        if (!object(part) || typeof part.text !== "string") continue
        const summary = { ...common, summary_index: summaryIndex }
        emit("response.reasoning_summary_part.added", { ...summary, part: { ...part, text: "" } })
        emit("response.reasoning_summary_text.delta", { ...summary, delta: part.text })
        emit("response.reasoning_summary_text.done", { ...summary, text: part.text })
        emit("response.reasoning_summary_part.done", { ...summary, part })
      }
    if (Array.isArray(item.content)) {
      for (const [contentIndex, part] of item.content.entries()) {
        if (!object(part)) continue
        const content = { ...common, content_index: contentIndex }
        emit("response.content_part.added", {
          ...content,
          part: { ...part, ...(part.type === "output_text" ? { text: "" } : {}) },
        })
        if (part.type === "output_text" && typeof part.text === "string") {
          emit("response.output_text.delta", { ...content, delta: part.text })
          emit("response.output_text.done", { ...content, text: part.text })
        }
        emit("response.content_part.done", { ...content, part })
      }
    }
    emit("response.output_item.done", { output_index: outputIndex, item })
  }
  const terminal =
    value.status === "failed"
      ? "failed"
      : value.status === "incomplete"
        ? "incomplete"
        : "completed"
  emit(`response.${terminal}`, { response: value })
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
