import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"

export const MCPCF_PROXY_SIGNING_SECRET_MIN_LENGTH = 32

export function requiredConfigString(name: string) {
  return Effect.orDie(Config.String(name))
}

/** The value of an optional environment variable, or undefined when it is not set. */
export function optionalConfigString(name: string) {
  return Effect.orDie(Config.String(name).pipe(Config.option)).pipe(
    Effect.map(Option.getOrUndefined),
  )
}

export function configSecretWithDefault(name: string, defaultValue: string) {
  return Config.Redacted(name).pipe(
    Config.withDefault(Redacted.make(defaultValue)),
    Effect.orDie,
    Effect.map(Redacted.value),
  )
}
