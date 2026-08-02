import type { StreamCallback } from "@cloudflare/think"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import { toError } from "../../lib/effect-errors"
import { stringifyJson } from "../../lib/json"
import { getFinishReason, getTextDelta, isStepLimitFinishReason } from "./message-chunks"

const STEP_LIMIT_FINAL_RESPONSE_PROMPT = (stepLimit: number) =>
  [
    `The previous isolate response reached the ${stepLimit}-step tool-call limit before producing a final answer.`,
    "You cannot make any more tool calls for this response.",
    "Finish the response to the user using the evidence and tool results already available in this conversation.",
    "If the available evidence is insufficient, say exactly what is missing and what the user can ask you to do next.",
  ].join("\n")

const STREAM_INTERRUPTED_MESSAGE =
  "Isolate stream interrupted before completion; recovery continuation owns the final response."

type StreamStartEvent = Parameters<StreamCallback["onStart"]>[0]

function failIfError(error: Option.Option<string>) {
  return Option.match(error, {
    onNone: () => Effect.void,
    onSome: (message) => Effect.fail(toError(message)),
  })
}

function emitStepLimitWarning(callback: StreamCallback | undefined, stepLimit: number) {
  return Effect.tryPromise({
    try: () =>
      callback?.onEvent(
        stringifyJson({
          type: "step_limit_warning",
          stepLimit,
          message:
            "The agent reached the step limit for this response and will finish without more tool calls.",
        }),
      ) ?? Promise.resolve(),
    catch: toError,
  })
}

function emptyResponseMessage(finishReason: Option.Option<string>): string {
  return Match.value(isStepLimitFinishReason(finishReason)).pipe(
    Match.when(
      true,
      () => "The model reached the tool-call step limit before producing a final response",
    ),
    Match.orElse(() => "Isolate model returned an empty response"),
  )
}

export function runChatWithStepLimitRecovery(input: {
  content: string
  stepLimit: number
  callback?: StreamCallback
  onStreamStart?: (event: StreamStartEvent) => void | Promise<void>
  onStreamInterrupted?: () => void | Promise<void>
  chat: (content: string, callback: StreamCallback) => Promise<void>
  enableFinalizationMode: () => void
  getFallbackAssistantText: () => string
}) {
  return Effect.gen(function* () {
    let output = ""
    let lastError = Option.none<string>()
    let finishReason = Option.none<string>()
    let interrupted = false

    const relay: StreamCallback = {
      onStart: async (event) => {
        await input.onStreamStart?.(event)
        await input.callback?.onStart(event)
      },
      onEvent: async (json) => {
        finishReason = Option.orElse(getFinishReason(json), () => finishReason)
        output += getTextDelta(json)
        await input.callback?.onEvent(json)
      },
      onDone: async () => {
        await input.callback?.onDone()
      },
      onError: async (error) => {
        lastError = Option.some(error)
        await input.callback?.onError?.(error)
      },
      onInterrupted: async () => {
        interrupted = true
        await input.onStreamInterrupted?.()
        await input.callback?.onInterrupted?.()
      },
    }

    const runChat = (content: string) =>
      Effect.tryPromise({
        try: () => input.chat(content, relay),
        catch: toError,
      })

    const recovery = emitStepLimitWarning(input.callback, input.stepLimit).pipe(
      Effect.flatMap(() =>
        Effect.sync(() => {
          input.enableFinalizationMode()
          lastError = Option.none<string>()
          finishReason = Option.none<string>()
        }),
      ),
      Effect.flatMap(() => runChat(STEP_LIMIT_FINAL_RESPONSE_PROMPT(input.stepLimit))),
      Effect.flatMap(() => failIfError(lastError)),
    )

    const interruptedFailure = Effect.fail(toError(STREAM_INTERRUPTED_MESSAGE))
    const shouldFailInterrupted = Effect.succeed(interrupted)
    yield* runChat(input.content)
    yield* Effect.when(interruptedFailure, shouldFailInterrupted)
    yield* failIfError(lastError)
    const shouldRecover = Effect.succeed(isStepLimitFinishReason(finishReason))
    yield* Effect.when(recovery, shouldRecover)

    const trimmedOutput = output.trim()
    const finalOutput = Option.getOrElse(
      Option.liftPredicate(trimmedOutput, (value) => value.length > 0),
      () => input.getFallbackAssistantText(),
    )

    return yield* Option.match(
      Option.liftPredicate(finalOutput.trim(), (value) => value.length > 0),
      {
        onNone: () => Effect.fail(toError(emptyResponseMessage(finishReason))),
        onSome: (value) => Effect.succeed(value),
      },
    )
  })
}
