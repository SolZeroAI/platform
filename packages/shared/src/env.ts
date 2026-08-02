import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"

export const MCPCF_PROXY_SIGNING_SECRET_MIN_LENGTH = 32

export function requireEnv(name: string): string {
  // oxlint-disable-next-line effect/avoid-process-env -- This shared Node-side helper is only for infra/scripts that read CLI process env.
  return Option.fromNullishOr(process.env[name]?.trim()).pipe(
    Option.filter((value) => value !== ""),
    Option.getOrThrowWith(
      () => new Error(`${name} is not set. Configure it in the repo env file.`),
    ),
  )
}

export function requiredConfigString(name: string) {
  return Effect.orDie(Config.string(name))
}

export function requiredNonEmptyConfigString(name: string) {
  return requiredConfigString(name).pipe(
    Effect.flatMap((value) =>
      Option.fromNullishOr(value).pipe(
        Option.map((text) => text.trim()),
        Option.filter((text) => text.length > 0),
        Option.match({
          onNone: () =>
            Effect.die(new Error(`${name} is not set. Configure it in the stage env file.`)),
          onSome: (text) => Effect.succeed(text),
        }),
      ),
    ),
  )
}

export function configStringWithDefault(name: string, defaultValue: string) {
  return Effect.orDie(Config.string(name).pipe(Config.withDefault(defaultValue)))
}

export function requiredConfigSecret(name: string) {
  return Config.redacted(name).pipe(Effect.orDie, Effect.map(Redacted.value))
}

export function requiredNonEmptyConfigSecret(name: string) {
  return requiredConfigSecret(name).pipe(
    Effect.flatMap((value) =>
      Option.fromNullishOr(value).pipe(
        Option.map((text) => text.trim()),
        Option.filter((text) => text.length > 0),
        Option.match({
          onNone: () =>
            Effect.die(new Error(`${name} is not set. Configure it in the stage env file.`)),
          onSome: Effect.succeed,
        }),
      ),
    ),
  )
}

export function requiredConfigSecretWithMinLength(name: string, minLength: number) {
  return requiredConfigSecret(name).pipe(
    Effect.flatMap((value) =>
      Option.fromNullishOr(value).pipe(
        Option.map((text) => text.trim()),
        Option.filter((text) => text.length >= minLength),
        Option.match({
          onNone: () =>
            Effect.die(
              new Error(
                `${name} must contain at least ${minLength} characters. Configure it in the stage env file.`,
              ),
            ),
          onSome: Effect.succeed,
        }),
      ),
    ),
  )
}

export function configSecretWithDefault(name: string, defaultValue: string) {
  return Config.redacted(name).pipe(
    Config.withDefault(Redacted.make(defaultValue)),
    Effect.orDie,
    Effect.map(Redacted.value),
  )
}
