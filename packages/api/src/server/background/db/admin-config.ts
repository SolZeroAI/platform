import {
  EMPTY_ADMIN_CONFIG,
  isAdminEmail,
  normalizeAdminConfig,
  type AdminConfig,
} from "@c0-agent/shared"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import {
  C0_CONFIG_BINDINGS,
  C0_CONFIG_KEYS,
  C0_CONFIG_LOCATIONS,
  C0ConfigStore,
  getC0DeploymentConfig,
} from "./c0-config"
import type { Env } from "../types"

export interface AdminConfigPresence {
  configured: boolean
  source: "deployment" | "kv" | "default"
  locked: boolean
  envVarName: string | null
  config: AdminConfig
}

function getStore(env: Env): Option.Option<C0ConfigStore> {
  return Option.fromNullishOr(Reflect.get(env, "C0_CONFIG")).pipe(
    Option.map((kv) => new C0ConfigStore(kv as KVNamespace, env.REPO_SECRETS_ENCRYPTION_KEY)),
  )
}

export const getAdminConfigWithPresence = Effect.fn("adminConfig.getConfig")(function* (env: Env) {
  const deploymentValue = getC0DeploymentConfig<AdminConfig>(env, C0_CONFIG_BINDINGS.admin)

  return yield* Option.match(deploymentValue, {
    onSome: (value) =>
      Effect.succeed({
        configured: true,
        source: "deployment" as const,
        locked: true,
        envVarName: C0_CONFIG_LOCATIONS.admin,
        config: normalizeAdminConfig(value),
      } satisfies AdminConfigPresence),
    onNone: () =>
      Effect.gen(function* () {
        const store = getStore(env)
        const value = yield* Option.match(store, {
          onNone: () => Effect.succeed(Option.none<unknown>()),
          onSome: (resolved) => resolved.getJson(C0_CONFIG_KEYS.admin.config),
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
