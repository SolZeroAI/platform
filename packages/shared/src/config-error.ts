import * as Result from "effect/Result"
import * as Schema from "effect/Schema"

/** A deployment configuration value that fails validation. The message names the field path. */
export class ConfigValidationError extends Schema.TaggedError<ConfigValidationError>()(
  "ConfigValidationError",
  {
    message: Schema.String,
  },
) {}

export const invalidS0Config = (message: string) =>
  new ConfigValidationError({ message: `Invalid s0 configuration: ${message}` })

export const invalidAuthConfig = (message: string) =>
  new ConfigValidationError({ message: `Invalid auth configuration: ${message}` })

/** Succeeds when `valid` is true, else fails with `error`. */
export const ensureConfig = (valid: boolean, error: () => ConfigValidationError) =>
  Result.liftPredicate(valid, (passed) => passed, error)

/** Parses a URL and drops trailing slashes. */
export const normalizeUrl = (value: string, error: () => ConfigValidationError) =>
  Result.try({
    try: () => new URL(value).toString().replace(/\/+$/, ""),
    catch: error,
  })
