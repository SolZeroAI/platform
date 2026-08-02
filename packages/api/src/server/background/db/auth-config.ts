/* oxlint-disable c0-lint/no-if-statement, c0-lint/no-match-effect-branch -- Auth config resolution is a small env/KV adapter boundary; keeping source precedence and provider discriminants explicit makes fail-closed behavior auditable. */
import {
  c0ConfigPathForStage,
  normalizeAuthProviderRegistry,
  publicAuthProviderRegistry,
  type AuthProviderConfig,
  type C0AuthConfig,
  type CredentialAuthProviderConfig,
  type OidcAuthProviderConfig,
  type PublicAuthProviderRegistry,
  type SocialAuthProviderConfig,
} from "@c0-agent/shared"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import {
  C0_CONFIG_BINDINGS,
  C0_CONFIG_LOCATIONS,
  getC0DeploymentConfig,
  getC0DeploymentSecret,
} from "./c0-config"
import type { Env } from "../types"

export type ResolvedAuthProviderConfig =
  | CredentialAuthProviderConfig
  | (Omit<SocialAuthProviderConfig, "clientSecret"> & { clientSecret: string })
  | (Omit<OidcAuthProviderConfig, "clientSecret"> & { clientSecret: string })

export interface ResolvedAuthProviderRegistry {
  defaultSignInProviderId: string
  providers: Record<string, ResolvedAuthProviderConfig>
}

const getStoredAuthProviderRegistry = Effect.fn("authConfig.getStoredRegistry")(function* (
  env: Env,
) {
  const value = yield* getC0DeploymentConfig<C0AuthConfig>(env, C0_CONFIG_BINDINGS.auth).pipe(
    Option.match({
      onNone: () =>
        Effect.die(
          new Error(`Auth provider registry is not configured at ${C0_CONFIG_LOCATIONS.auth}`),
        ),
      onSome: Effect.succeed,
    }),
  )
  return normalizeAuthProviderRegistry(value)
})

const resolveProviderClientSecret = Effect.fn("authConfig.resolveProviderClientSecret")(function* (
  env: Env,
  providerId: string,
  provider: SocialAuthProviderConfig | OidcAuthProviderConfig,
) {
  return yield* Option.match(getC0DeploymentSecret(env, provider.clientSecret), {
    onNone: () =>
      Effect.die(
        new Error(
          `${provider.clientSecret.env} is required for enabled auth provider '${providerId}'`,
        ),
      ),
    onSome: Effect.succeed,
  })
})

const resolveProvider = Effect.fn("authConfig.resolveProvider")(function* (
  env: Env,
  providerId: string,
  provider: AuthProviderConfig,
) {
  if (provider.kind === "credential") {
    return provider
  }
  if (!provider.enabled) {
    return { ...provider, clientSecret: "" }
  }
  const clientSecret = yield* resolveProviderClientSecret(env, providerId, provider)
  return { ...provider, clientSecret }
})

export const getAuthProviderRegistry = Effect.fn("authConfig.getAuthProviderRegistry")(function* (
  env: Env,
) {
  const registry = yield* getStoredAuthProviderRegistry(env)
  const providerEntries = yield* Effect.forEach(
    Object.entries(registry.providers),
    ([providerId, provider]) =>
      resolveProvider(env, providerId, provider).pipe(
        Effect.map((resolved) => [providerId, resolved] as const),
      ),
    { concurrency: "unbounded" },
  )
  return {
    defaultSignInProviderId: registry.defaultSignInProviderId,
    providers: Object.fromEntries(providerEntries),
  } satisfies ResolvedAuthProviderRegistry
})

export const getPublicAuthProviderRegistry = Effect.fn("authConfig.getPublicAuthProviderRegistry")(
  function* (env: Env) {
    const registry = yield* getStoredAuthProviderRegistry(env)
    return publicAuthProviderRegistry(
      registry,
      c0ConfigPathForStage(env.STAGE),
    ) satisfies PublicAuthProviderRegistry
  },
)

export const getStoredAuthProviderRegistryForTesting = getStoredAuthProviderRegistry
