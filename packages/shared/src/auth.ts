import * as Match from "effect/Match"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import { ensureConfig, invalidAuthConfig, normalizeUrl } from "./config-error"
import { normalizeSecretReference, SecretReferenceSchema } from "./secret-reference"

export const AUTH_PROVIDER_ID_PATTERN = /^[a-z][a-z0-9_-]*$/
export const CREDENTIAL_AUTH_PROVIDER_ID = "credential"
export const DEFAULT_OIDC_SCOPES = ["openid", "profile", "email", "offline_access"] as const

export const AuthProviderCapabilitiesSchema = Schema.Struct({
  signIn: Schema.Boolean,
  provisionUsers: Schema.Boolean,
  link: Schema.Boolean,
})

export type AuthProviderCapabilities = typeof AuthProviderCapabilitiesSchema.Type

export const CredentialAuthProviderConfigSchema = Schema.Struct({
  kind: Schema.Literal("credential"),
  enabled: Schema.Boolean,
  displayName: Schema.String,
  capabilities: AuthProviderCapabilitiesSchema,
  provisioning: Schema.Struct({
    scope: Schema.Literal("configured-admins"),
  }),
})

export type CredentialAuthProviderConfig = typeof CredentialAuthProviderConfigSchema.Type

export const SocialAuthProviderConfigSchema = Schema.Struct({
  kind: Schema.Literal("social"),
  enabled: Schema.Boolean,
  displayName: Schema.String,
  clientId: Schema.String,
  clientSecret: SecretReferenceSchema,
  scopes: Schema.optional(Schema.Array(Schema.String)),
  capabilities: AuthProviderCapabilitiesSchema,
})

export type SocialAuthProviderConfig = typeof SocialAuthProviderConfigSchema.Type

export const OidcAuthProviderConfigSchema = Schema.Struct({
  kind: Schema.Literal("oidc"),
  enabled: Schema.Boolean,
  displayName: Schema.String,
  issuer: Schema.String,
  clientId: Schema.String,
  clientSecret: SecretReferenceSchema,
  scopes: Schema.optional(Schema.Array(Schema.String)),
  capabilities: AuthProviderCapabilitiesSchema,
})

export type OidcAuthProviderConfig = typeof OidcAuthProviderConfigSchema.Type

export const AuthProviderConfigSchema = Schema.Union([
  CredentialAuthProviderConfigSchema,
  SocialAuthProviderConfigSchema,
  OidcAuthProviderConfigSchema,
])

export type AuthProviderConfig = typeof AuthProviderConfigSchema.Type

export const AuthProviderRegistrySchema = Schema.Struct({
  defaultSignInProviderId: Schema.String,
  providers: Schema.Record(Schema.String, AuthProviderConfigSchema),
})

export type AuthProviderRegistry = typeof AuthProviderRegistrySchema.Type

export interface PublicAuthProvider {
  id: string
  kind: AuthProviderConfig["kind"]
  displayName: string
  capabilities: Pick<AuthProviderCapabilities, "signIn" | "link">
}

export interface PublicAuthProviderRegistry {
  defaultSignInProviderId: string
  providers: PublicAuthProvider[]
  configurationFile: string
}

function requireNonEmpty(value: string, field: string) {
  return Result.liftPredicate(
    value.trim(),
    (normalized) => normalized !== "",
    () => invalidAuthConfig(`${field} must not be empty`),
  )
}

function normalizeScopes(scopes: readonly string[] | undefined, defaults: readonly string[]) {
  const normalized = [...new Set((scopes ?? defaults).map((scope) => scope.trim()).filter(Boolean))]

  return Match.value(normalized.length > 0).pipe(
    Match.when(true, () => normalized),
    Match.when(false, () => [...defaults]),
    Match.exhaustive,
  )
}

const normalizeCredentialProvider = (providerId: string, provider: CredentialAuthProviderConfig) =>
  Result.gen(function* () {
    yield* ensureConfig(providerId === CREDENTIAL_AUTH_PROVIDER_ID, () =>
      invalidAuthConfig(`the credential provider id must be '${CREDENTIAL_AUTH_PROVIDER_ID}'`),
    )

    const { signIn, provisionUsers, link } = provider.capabilities

    yield* ensureConfig(!provider.enabled || (signIn && provisionUsers && !link), () =>
      invalidAuthConfig(
        "the credential provider must sign in and provision configured admins, and cannot link",
      ),
    )

    return provider
  })

const normalizeClientCredentials = (
  providerId: string,
  provider: SocialAuthProviderConfig | OidcAuthProviderConfig,
) =>
  Result.all({
    clientId: requireNonEmpty(provider.clientId, `providers.${providerId}.clientId`),
    clientSecret: normalizeSecretReference(
      provider.clientSecret,
      `auth.providers.${providerId}.clientSecret`,
    ),
  })

const normalizeSocialProvider = (providerId: string, provider: SocialAuthProviderConfig) =>
  normalizeClientCredentials(providerId, provider).pipe(
    Result.map((credentials) => ({
      ...provider,
      ...credentials,
      scopes: normalizeScopes(provider.scopes, []),
    })),
  )

const normalizeOidcProvider = (providerId: string, provider: OidcAuthProviderConfig) =>
  Result.gen(function* () {
    const credentials = yield* normalizeClientCredentials(providerId, provider)
    const issuer = yield* requireNonEmpty(provider.issuer, `providers.${providerId}.issuer`)

    return {
      ...provider,
      ...credentials,
      issuer: yield* normalizeUrl(issuer, () =>
        invalidAuthConfig(`providers.${providerId}.issuer must be a valid URL`),
      ),
      scopes: normalizeScopes(provider.scopes, DEFAULT_OIDC_SCOPES),
    }
  })

const normalizeProvider = (rawProviderId: string, provider: AuthProviderConfig) =>
  Result.gen(function* () {
    const providerId = rawProviderId.trim().toLowerCase()

    yield* ensureConfig(AUTH_PROVIDER_ID_PATTERN.test(providerId), () =>
      invalidAuthConfig(`provider id '${rawProviderId}' must match ${AUTH_PROVIDER_ID_PATTERN}`),
    )

    yield* ensureConfig(providerId === rawProviderId, () =>
      invalidAuthConfig(`provider id '${rawProviderId}' must already be normalized`),
    )

    yield* ensureConfig(!provider.capabilities.provisionUsers || provider.capabilities.signIn, () =>
      invalidAuthConfig(
        `provider '${providerId}' cannot provision users without sign-in capability`,
      ),
    )

    const displayName = yield* requireNonEmpty(
      provider.displayName,
      `providers.${providerId}.displayName`,
    )

    const normalized: AuthProviderConfig = yield* Match.value({ ...provider, displayName }).pipe(
      Match.discriminatorsExhaustive("kind")({
        credential: (credential) => normalizeCredentialProvider(providerId, credential),
        social: (social) => normalizeSocialProvider(providerId, social),
        oidc: (oidc) => normalizeOidcProvider(providerId, oidc),
      }),
    )

    return [providerId, normalized] as const
  })

/** Validates a decoded registry and normalizes provider ids, names, client ids, and scopes. */
export const validateAuthProviderRegistry = (decoded: AuthProviderRegistry) =>
  Result.gen(function* () {
    const providers: AuthProviderRegistry["providers"] = Object.fromEntries(
      yield* Result.all(
        Object.entries(decoded.providers).map(([providerId, provider]) =>
          normalizeProvider(providerId, provider),
        ),
      ),
    )

    const signInProviderIds = Object.entries(providers)
      .filter(([, provider]) => provider.enabled && provider.capabilities.signIn)
      .map(([providerId]) => providerId)

    yield* ensureConfig(signInProviderIds.length > 0, () =>
      invalidAuthConfig("at least one provider must allow sign-in"),
    )

    const defaultSignInProviderId = decoded.defaultSignInProviderId.trim().toLowerCase()

    yield* ensureConfig(signInProviderIds.includes(defaultSignInProviderId), () =>
      invalidAuthConfig("defaultSignInProviderId must reference an enabled sign-in provider"),
    )

    return { defaultSignInProviderId, providers }
  })

export function normalizeAuthProviderRegistry(value: unknown): AuthProviderRegistry {
  // oxlint-disable-next-line effect/avoid-option-getorthrow -- Synchronous boundary for non-Effect callers: invalid input throws the typed error by contract.
  return Result.getOrThrow(
    validateAuthProviderRegistry(Schema.decodeUnknownSync(AuthProviderRegistrySchema)(value)),
  )
}

export function publicAuthProviderRegistry(
  registry: AuthProviderRegistry,
  configurationFile: string,
): PublicAuthProviderRegistry {
  return {
    defaultSignInProviderId: registry.defaultSignInProviderId,
    providers: Object.entries(registry.providers)
      .filter(([, provider]) => provider.enabled)
      .map(([id, provider]) => ({
        id,
        kind: provider.kind,
        displayName: provider.displayName,
        capabilities: {
          signIn: provider.capabilities.signIn,
          link: provider.capabilities.link,
        },
      })),
    configurationFile,
  }
}
