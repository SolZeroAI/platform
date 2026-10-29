import * as Option from "effect/Option"
import * as P from "effect/Predicate"

// Field readers for registry JSON that S0_CONFIG stores. A field with the wrong type reads as the
// fallback.

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isUnknownArray(value: unknown): value is ReadonlyArray<unknown> {
  return Array.isArray(value)
}

export function stringField(record: Record<string, unknown>, key: string, fallback = ""): string {
  return Option.liftPredicate(record[key], P.isString).pipe(Option.getOrElse(() => fallback))
}

export function nonBlankStringField(record: Record<string, unknown>, key: string) {
  return Option.liftPredicate(record[key], P.isString).pipe(
    Option.filter((value) => value.trim().length > 0),
  )
}

export function numberField(
  record: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  return Option.liftPredicate(record[key], P.isNumber).pipe(
    Option.filter(Number.isFinite),
    Option.getOrElse(() => fallback),
  )
}

export function booleanField(
  record: Record<string, unknown>,
  key: string,
  fallback: boolean,
): boolean {
  return Option.liftPredicate(record[key], P.isBoolean).pipe(Option.getOrElse(() => fallback))
}

export function readArray(value: unknown): ReadonlyArray<unknown> {
  return Option.liftPredicate(value, isUnknownArray).pipe(Option.getOrElse(() => []))
}

export function readStringArray(value: unknown): string[] {
  return readArray(value).filter(P.isString)
}
