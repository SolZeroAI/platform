import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import type {
  AiSearchAiSearchResponse as FormattedAiSearchAiSearchResponse,
  AiSearchResultItem,
  AiSearchSearchResponse as FormattedAiSearchSearchResponse,
  Env,
} from "../background/types"
import type { AiSearchSourceRecord } from "../background/db/ai-search"
import type { RequestLogger } from "../effect/services/observability"
import { toError } from "../lib/effect-errors"

export type AiSearchToolMode = "search" | "aiSearch"

export interface AiSearchMcpRuntimeContext {
  readonly log: Pick<RequestLogger, "error">
}

class AiSearchMcpRuntimeError extends Schema.TaggedErrorClass<AiSearchMcpRuntimeError>()(
  "AiSearchMcpRuntimeError",
  {
    message: Schema.String,
  },
) {}

const aiSearchFail = (message: string) => Effect.fail(new AiSearchMcpRuntimeError({ message }))

const trimmedText = (value: string | undefined) =>
  Match.value(value).pipe(
    Match.when(Match.string, (text) => text.trim()),
    Match.orElse(() => ""),
  )

const nonEmptyTrimmedParts = (parts: readonly { text?: string }[]) =>
  parts.flatMap((part) =>
    Match.value(trimmedText(part.text).length > 0).pipe(
      Match.when(true, () => [trimmedText(part.text)]),
      Match.orElse(() => [] as string[]),
    ),
  )

const scoreSuffixFor = (score: number | undefined) =>
  Match.value(score).pipe(
    Match.when(Match.number, (value) => ` (score ${value.toFixed(2)})`),
    Match.orElse(() => ""),
  )

function formatAiSearchSource(item: AiSearchResultItem): string {
  const filename = item.filename ?? "Unknown source"
  const scoreSuffix = scoreSuffixFor(item.score)
  const snippet = nonEmptyTrimmedParts(item.content ?? []).join("\n")
  return Match.value(snippet.length > 0).pipe(
    Match.when(true, () => `${filename}${scoreSuffix}\n${snippet}`),
    Match.orElse(() => filename + scoreSuffix),
  )
}

function normalizeBindingSearchResponse(
  result: AiSearchSearchResponse,
): FormattedAiSearchSearchResponse {
  return {
    data: result.chunks.map((chunk) => ({
      file_id: chunk.id,
      filename: chunk.item.key,
      score: chunk.score,
      content: [
        {
          id: chunk.id,
          type: chunk.type,
          text: chunk.text,
        },
      ],
    })),
  }
}

function normalizeBindingChatResponse(
  result: AiSearchChatCompletionsResponse,
): FormattedAiSearchAiSearchResponse {
  const response = result.choices
    .flatMap((choice) =>
      Match.value(trimmedText(choice.message.content ?? undefined).length > 0).pipe(
        Match.when(true, () => [trimmedText(choice.message.content ?? undefined)]),
        Match.orElse(() => [] as string[]),
      ),
    )
    .join("\n\n")

  return {
    response,
    data: normalizeBindingSearchResponse({
      search_query: "",
      chunks: result.chunks,
    }).data,
  }
}

const formattedSources = (items: readonly AiSearchResultItem[]) =>
  items.map((item) => formatAiSearchSource(item)).filter((formatted) => formatted.length > 0)

const responseTextFrom = (
  result: FormattedAiSearchAiSearchResponse | FormattedAiSearchSearchResponse,
) =>
  Match.value("response" in result && typeof result.response === "string").pipe(
    Match.when(true, () => (result as FormattedAiSearchAiSearchResponse).response?.trim() ?? ""),
    Match.orElse(() => ""),
  )

export function formatAiSearchToolResponse(
  source: AiSearchSourceRecord,
  result: FormattedAiSearchAiSearchResponse | FormattedAiSearchSearchResponse,
): string {
  const responseText = responseTextFrom(result)
  const responsePart = Match.value(responseText.length > 0).pipe(
    Match.when(true, () => [responseText]),
    Match.orElse(() => [] as string[]),
  )
  const sources = formattedSources(result.data ?? [])
  const sourcePart = Match.value(sources.length > 0).pipe(
    Match.when(true, () => [
      `Sources:\n${sources.map((value, index) => `${index + 1}. ${value}`).join("\n\n")}`,
    ]),
    Match.orElse(() => [] as string[]),
  )
  return [source.label, ...responsePart, ...sourcePart].join("\n\n")
}

const logAiSearchFailure = (input: {
  readonly context: AiSearchMcpRuntimeContext
  readonly source: AiSearchSourceRecord
  readonly query: string
  readonly mode: AiSearchToolMode
  readonly error: Error
}) =>
  Effect.sync(() => {
    input.context.log.error(input.error, {
      event: "ai_search.mcp.search.failed",
      aiSearch: {
        sourceId: input.source.id,
        mode: input.mode,
        queryLength: input.query.length,
      },
    })
  })

const searchBinding = (
  instance: ReturnType<NonNullable<Env["AI_SEARCH"]>["get"]>,
  query: string,
  maxResults: number,
) =>
  Effect.tryPromise({
    try: () =>
      instance.search({
        query,
        ai_search_options: {
          retrieval: {
            max_num_results: maxResults,
          },
          query_rewrite: {
            enabled: true,
          },
        },
      }),
    catch: toError,
  }).pipe(Effect.map(normalizeBindingSearchResponse))

const chatBinding = (
  instance: ReturnType<NonNullable<Env["AI_SEARCH"]>["get"]>,
  query: string,
  maxResults: number,
) =>
  Effect.tryPromise({
    try: () =>
      instance.chatCompletions({
        messages: [{ role: "user", content: query }],
        ai_search_options: {
          retrieval: {
            max_num_results: maxResults,
          },
          query_rewrite: {
            enabled: true,
          },
        },
      }),
    catch: toError,
  }).pipe(Effect.map(normalizeBindingChatResponse))

const executeAiSearch = Effect.fn("mcp.aiSearch.execute")(function* (
  env: Env,
  source: AiSearchSourceRecord,
  query: string,
  mode: AiSearchToolMode,
) {
  const binding = Option.fromNullishOr(env.AI_SEARCH)
  const instance = yield* Option.match(binding, {
    onNone: () => aiSearchFail("AI Search namespace binding is not configured"),
    onSome: (aiSearch) => Effect.succeed(aiSearch.get(source.id)),
  })
  const result = yield* Match.value(mode).pipe(
    Match.when("search", () => searchBinding(instance, query, source.maxResults)),
    Match.when("aiSearch", () => chatBinding(instance, query, source.maxResults)),
    Match.exhaustive,
  )
  return formatAiSearchToolResponse(source, result)
})

export const runAiSearchMcpTool = Effect.fn("mcp.aiSearch.runTool")(function* (
  env: Env,
  source: AiSearchSourceRecord,
  query: string,
  context: AiSearchMcpRuntimeContext,
  mode: AiSearchToolMode,
) {
  return yield* executeAiSearch(env, source, query, mode).pipe(
    Effect.catch((cause) =>
      logAiSearchFailure({
        context,
        source,
        query,
        mode,
        error: toError(cause),
      }).pipe(Effect.flatMap(() => Effect.fail(cause))),
    ),
  )
})
