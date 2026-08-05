import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import { S0_CONFIG_KEYS, S0ConfigStore } from "../db/s0-config"
import { dotenvAssignment } from "../../lib/dotenv"
import { stringifyJson } from "../../lib/json"
import type { Env } from "../types"
import type { LitellmProviderConfigExport } from "./litellm-types"

function getStore(env: Env): S0ConfigStore {
  return new S0ConfigStore(env.S0_CONFIG, env.REPO_SECRETS_ENCRYPTION_KEY)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): Option.Option<string> {
  return Option.some(value).pipe(
    Option.filter((input): input is string => typeof input === "string"),
    Option.map((input) => input.trim()),
    Option.filter((input) => input.length > 0),
  )
}

function booleanValue(value: unknown): boolean {
  return value === true
}

function stringRecord(value: unknown): Record<string, string> {
  const record = Option.getOrElse(
    Option.filter(Option.some(value), isRecord),
    () => ({}) as Record<string, unknown>,
  )
  return Object.fromEntries(
    Object.entries(record).flatMap(([key, recordValue]) =>
      Option.match(stringValue(recordValue), {
        onNone: () => [],
        onSome: (resolved) => [[key, resolved] as const],
      }),
    ),
  )
}

function exportConfigValue(value: unknown) {
  const record = Option.getOrElse(
    Option.filter(Option.some(value), isRecord),
    () => ({}) as Record<string, unknown>,
  )
  return {
    enabled: booleanValue(record.enabled),
    baseUrl: Option.getOrElse(stringValue(record.baseUrl), () => ""),
    defaultModel: Option.getOrNull(stringValue(record.defaultModel)),
    defaultReasoningLevel: Option.getOrNull(stringValue(record.defaultReasoningLevel)),
    adapterOverrides: stringRecord(record.adapterOverrides),
  }
}

export const exportLitellmProviderConfig = Effect.fn("aiProviders.litellm.exportProviderConfig")(
  function* (env: Env) {
    const store = getStore(env)
    const [configValue, apiKeyConfigured] = yield* Effect.all(
      [
        store.getJson(S0_CONFIG_KEYS.aiProviders.litellmConfig),
        store.encryptedSecretConfigured(S0_CONFIG_KEYS.aiProviders.litellmApiKey),
      ],
      { concurrency: "unbounded" },
    )
    const apiKey = yield* Match.value(apiKeyConfigured).pipe(
      Match.when(true, () => store.getEncryptedSecret(S0_CONFIG_KEYS.aiProviders.litellmApiKey)),
      Match.orElse(() => Effect.succeed(Option.none<string>())),
    )
    const apiKeyEnvironmentVariable = "S0_LITELLM_API_KEY"
    const apiKeyValue = Option.filter(apiKey, (value) => value.length > 0)
    const configLines = Option.match(configValue, {
      onNone: () => ["// No KV-backed LiteLLM configuration is configured."],
      onSome: (resolved) => [
        "// Merge this object into the active <stage>.config.jsonc file.",
        stringifyJson({
          aiProviders: {
            litellm: {
              ...exportConfigValue(resolved),
              ...Option.match(apiKeyValue, {
                onNone: () => ({}),
                onSome: () => ({ apiKey: { env: apiKeyEnvironmentVariable } }),
              }),
            },
          },
        }),
      ],
    })
    const secretAssignment = yield* Effect.forEach(Option.toArray(apiKeyValue), (resolved) =>
      dotenvAssignment(apiKeyEnvironmentVariable, resolved),
    )
    const secretLines = secretAssignment.flatMap((assignment) => [
      "",
      "# Configure this secret in the stage environment.",
      assignment,
    ])
    const lines = [...configLines, ...secretLines]
    const variableCount = Number(Option.isSome(configValue)) + Number(Option.isSome(apiKeyValue))

    return {
      dotenv: `${lines.join("\n")}\n`,
      variableCount,
      includesSecret: Option.isSome(apiKeyValue),
      includesRegistry: false,
    } satisfies LitellmProviderConfigExport
  },
)

export const resetLitellmProviderConfig = Effect.fn("aiProviders.litellm.resetProviderConfig")(
  function* (env: Env) {
    const store = getStore(env)
    const deletedKeys = [
      S0_CONFIG_KEYS.aiProviders.litellmConfig,
      S0_CONFIG_KEYS.aiProviders.litellmApiKey,
      S0_CONFIG_KEYS.aiProviders.litellmModels,
    ]
    yield* Effect.all(
      deletedKeys.map((key) => store.delete(key)),
      { concurrency: "unbounded" },
    )
    return { deletedKeys }
  },
)
