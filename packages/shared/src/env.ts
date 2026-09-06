import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"

export const MCPCF_PROXY_SIGNING_SECRET_MIN_LENGTH = 32

export function requiredConfigString(name: string) {
  return Effect.orDie(Config.string(name))
}

export function configSecretWithDefault(name: string, defaultValue: string) {
  return Config.redacted(name).pipe(
    Config.withDefault(Redacted.make(defaultValue)),
    Effect.orDie,
    Effect.map(Redacted.value),
  )
}
