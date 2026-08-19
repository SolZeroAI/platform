import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

// Centralized JSON boundary helpers. Importing these keeps `JSON.parse`/`JSON.stringify`
// and try/catch out of caller modules without forcing those modules to depend on `effect`
// directly (which would otherwise activate the Effect-file lint rules across them).

const decodeRecordOption = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
)
const decodeArrayOption = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(Schema.Unknown)),
)
const decodeValueOption = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))
const decodeValueSync = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))
const encodeJsonString = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown))
const encodeJsonStringOption = Schema.encodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

const emptyRecord = (): Record<string, unknown> => ({})
const emptyArray = (): readonly unknown[] => []

/** Parse a JSON object string as an Option, `None` for null/invalid/non-object input. */
export const decodeJsonRecord = (
  value: string | null | undefined,
): Option.Option<Record<string, unknown>> => decodeRecordOption(value)

/** Parse a JSON array string as an Option, `None` for null/invalid/non-array input. */
export const decodeJsonArray = (
  value: string | null | undefined,
): Option.Option<readonly unknown[]> => decodeArrayOption(value)

/** Parse any JSON string as an Option<unknown>, `None` for null/invalid input. */
export const decodeJson = (value: string | null | undefined): Option.Option<unknown> =>
  decodeValueOption(value)

/** Parse a JSON object string, returning `{}` for null/invalid/non-object input. */
export const parseJsonRecord = (value: string | null | undefined): Record<string, unknown> =>
  Option.getOrElse(decodeRecordOption(value), emptyRecord)

/** Parse a JSON array string, returning `[]` for null/invalid/non-array input. */
export const parseJsonArray = (value: string | null | undefined): readonly unknown[] =>
  Option.getOrElse(decodeArrayOption(value), emptyArray)

/** Parse a JSON string strictly, throwing on invalid input (like `JSON.parse`). */
export const parseJson = (value: string): unknown => decodeValueSync(value)

/** Parse a JSON string, returning the original string when it is not valid JSON. */
export const parseJsonOrText = (value: string): unknown =>
  Option.getOrElse(decodeValueOption(value), () => value)

/** Serialize a value to a compact JSON string (throws on cycles, like `JSON.stringify`). */
export const stringifyJson = (value: unknown): string => encodeJsonString(value)

/**
 * Serialize a value to a compact JSON string, falling back to `fallback(value)`
 * (default `String(value)`) when the value cannot be serialized. Never throws.
 */
export const stringifyJsonOr = (
  value: unknown,
  fallback: (value: unknown) => string = (input) => String(input),
): string => Option.getOrElse(encodeJsonStringOption(value), () => fallback(value))
