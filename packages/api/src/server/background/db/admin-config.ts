import {
  EMPTY_ADMIN_CONFIG,
  isAdminEmail,
  normalizeAdminConfig,
  type AdminConfig,
} from "@solzero/shared"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import {
  S0_CONFIG_BINDINGS,
  S0_CONFIG_KEYS,
  S0_CONFIG_LOCATIONS,
  S0ConfigStore,
  getS0DeploymentConfig,
} from "./s0-config"
import type { Env } from "../types"

export interface AdminConfigPresence {
  configured: boolean
  source: "deployment" | "kv" | "default"
  locked: boolean
  envVarName: string | null
  config: AdminConfig
}

function getStore(env: Env): Option.Option<S0ConfigStore> {
  return Option.fromNullishOr(Reflect.get(env, "S0_CONFIG")).pipe(
    Option.map((kv) => new S0ConfigStore(kv as KVNamespace, env.REPO_SECRETS_ENCRYPTION_KEY)),
  )
}

export const getAdminConfigWithPresence = Effect.fn("adminConfig.getConfig")(function* (env: Env) {
  const deploymentValue = getS0DeploymentConfig<AdminConfig>(env, S0_CONFIG_BINDINGS.admin)

  return yield* Option.match(deploymentValue, {
    onSome: (value) =>
      Effect.succeed({
        configured: true,
        source: "deployment" as const,
        locked: true,
        envVarName: S0_CONFIG_LOCATIONS.admin,
        config: normalizeAdminConfig(value),
      } satisfies AdminConfigPresence),
    onNone: () =>
      Effect.gen(function* () {
        const store = getStore(env)
        const value = yield* Option.match(store, {
          onNone: () => Effect.succeed(Option.none<unknown>()),
          onSome: (resolved) => resolved.getJson(S0_CONFIG_KEYS.admin.config),
        })
        return Option.match(value, {
          onSome: (config) =>
            ({
              configured: true,
              source: "kv" as const,
              locked: false,
              envVarName: null,
              config: normalizeAdminConfig(config),
            }) satisfies AdminConfigPresence,
          onNone: () =>
            ({
              configured: false,
              source: "default" as const,
              locked: false,
              envVarName: null,
              config: EMPTY_ADMIN_CONFIG,
            }) satisfies AdminConfigPresence,
        })
      }),
  })
})

export const getAdminConfig = Effect.fn("adminConfig.get")(function* (env: Env) {
  const presence = yield* getAdminConfigWithPresence(env)
  return presence.config
})

export const isAdminEmailForEnv = Effect.fn("adminConfig.isAdminEmail")(function* (
  env: Env,
  email: string | null | undefined,
) {
  const config = yield* getAdminConfig(env)
  return isAdminEmail(email, config)
})
