import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import { C0_CONFIG_KEYS, C0ConfigStore } from "../db/c0-config"
import { dotenvAssignment } from "../../lib/dotenv"
import { stringifyJson } from "../../lib/json"
import type { Env } from "../types"

export interface McpcfConfigExport {
  dotenv: string
  variableCount: number
  includesSecret: boolean
  includesRegistry: boolean
  serverCount: number
}

function getStore(env: Env): C0ConfigStore {
  return new C0ConfigStore(env.C0_CONFIG, env.REPO_SECRETS_ENCRYPTION_KEY)
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

function stringArrayValue(value: unknown): string[] {
  return Option.match(Option.filter(Option.some(value), Array.isArray), {
    onNone: () => [],
    onSome: (items) =>
      items.flatMap((item) =>
        Option.match(stringValue(item), {
          onNone: () => [],
          onSome: (resolved) => [resolved],
        }),
      ),
  })
}

function exportConfigValue(value: unknown) {
  const record = Option.getOrElse(
    Option.filter(Option.some(value), isRecord),
    () => ({}) as Record<string, unknown>,
  )
  return {
    enabled: booleanValue(record.enabled),
    baseUrl: Option.getOrElse(stringValue(record.baseUrl), () => ""),
    userOauthProviderId: Option.getOrElse(stringValue(record.userOauthProviderId), () => ""),
    expectedIssuer: Option.getOrNull(stringValue(record.expectedIssuer)),
    authTypeAllowlist: stringArrayValue(record.authTypeAllowlist),
    serverBlacklist: stringArrayValue(record.serverBlacklist),
  }
}

export const exportMcpcfConfig = Effect.fn("mcpcf.exportConfig")(function* (env: Env) {
  const store = getStore(env)
  const [configValue, adminApiTokenConfigured] = yield* Effect.all(
    [
      store.getJson(C0_CONFIG_KEYS.mcpcf.config),
      store.encryptedSecretConfigured(C0_CONFIG_KEYS.mcpcf.adminApiToken),
    ],
    { concurrency: "unbounded" },
  )
  const adminApiToken = yield* Match.value(adminApiTokenConfigured).pipe(
    Match.when(true, () => store.getEncryptedSecret(C0_CONFIG_KEYS.mcpcf.adminApiToken)),
    Match.orElse(() => Effect.succeed(Option.none<string>())),
  )
  const tokenEnvironmentVariable = "C0_MCPCF_ADMIN_API_TOKEN"
  const adminApiTokenValue = Option.filter(adminApiToken, (value) => value.length > 0)
  const configLines = Option.match(configValue, {
    onNone: () => ["// No KV-backed MCP Context Forge configuration is configured."],
    onSome: (resolved) => [
      "// Merge this object into the active <stage>.config.jsonc file.",
      stringifyJson({
        mcpcf: {
          ...exportConfigValue(resolved),
          ...Option.match(adminApiTokenValue, {
            onNone: () => ({}),
            onSome: () => ({ adminApiToken: { env: tokenEnvironmentVariable } }),
          }),
        },
      }),
    ],
  })
  const tokenAssignment = yield* Effect.forEach(Option.toArray(adminApiTokenValue), (resolved) =>
    dotenvAssignment(tokenEnvironmentVariable, resolved),
  )
  const tokenLines = tokenAssignment.flatMap((assignment) => [
    "",
    "# Configure this secret in the stage environment.",
    assignment,
  ])
  const lines = [...configLines, ...tokenLines]
  const variableCount =
    Number(Option.isSome(configValue)) + Number(Option.isSome(adminApiTokenValue))

  return {
    dotenv: `${lines.join("\n")}\n`,
    variableCount,
    includesSecret: Option.isSome(adminApiTokenValue),
    includesRegistry: false,
    serverCount: 0,
  } satisfies McpcfConfigExport
})

export const resetMcpcfConfig = Effect.fn("mcpcf.resetConfig")(function* (env: Env) {
  const store = getStore(env)
  const serverIndexValue = yield* store.getJson(C0_CONFIG_KEYS.mcpcf.serverIndex)
  const serverIds = Option.match(serverIndexValue, {
    onNone: () => [] as string[],
    onSome: stringArrayValue,
  })
  const deletedKeys = [
    C0_CONFIG_KEYS.mcpcf.config,
    C0_CONFIG_KEYS.mcpcf.adminApiToken,
    C0_CONFIG_KEYS.mcpcf.serverIndex,
    ...serverIds.map((serverId) => C0_CONFIG_KEYS.mcpcf.server(serverId)),
  ]
  yield* Effect.all(
    deletedKeys.map((key) => store.delete(key)),
    { concurrency: "unbounded" },
  )
  return { deletedKeys }
})
