import type { UIMessage, UIMessageChunk } from "ai"
import * as Arr from "effect/Array"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import { parseJsonOrText } from "../../lib/json"

type TextDeltaChunk = Extract<UIMessageChunk, { type: "text-delta" }>

function parseUiMessageChunk(json: string): Option.Option<UIMessageChunk> {
  return Option.liftPredicate(
    parseJsonOrText(json),
    (value): value is UIMessageChunk => Boolean(value) && typeof value === "object",
  )
}

export function getTextDelta(json: string): string {
  return parseUiMessageChunk(json).pipe(
    Option.flatMap((chunk) =>
      Option.liftPredicate(chunk, (value): value is TextDeltaChunk => value.type === "text-delta"),
    ),
    Option.map((chunk) => chunk.delta),
    Option.getOrElse(() => ""),
  )
}

export function getFinishReason(json: string): Option.Option<string> {
  return parseUiMessageChunk(json).pipe(
    Option.filter((chunk) => chunk.type === "finish"),
    Option.flatMap((chunk) =>
      Option.liftPredicate(
        (chunk as { finishReason?: unknown }).finishReason,
        (value): value is string => typeof value === "string",
      ),
    ),
  )
}

export function isStepLimitFinishReason(value: Option.Option<string>): boolean {
  return Option.exists(value, (reason) => reason === "tool-calls")
}

export function getLatestAssistantText(messages: UIMessage[]): string {
  return Option.match(
    Arr.findLast(messages, (message) => message.role === "assistant"),
    {
      onNone: () => "",
      onSome: (latestAssistant) =>
        latestAssistant.parts
          .map((part) =>
            Match.value(part).pipe(
              Match.when({ type: "text" }, (textPart) => textPart.text),
              Match.orElse(() => ""),
            ),
          )
          .join("")
          .trim(),
    },
  )
}
