/* oxlint-disable c0-lint/no-if-statement, c0-lint/no-return-in-arrow, c0-lint/no-return-in-callback -- Auth JSON normalization is a synchronous validation boundary; explicit discriminant branches keep invalid configuration errors adjacent to their fields. */
import * as Schema from "effect/Schema"
import * as Match from "effect/Match"
import { normalizeSecretReference, SecretReferenceSchema } from "./secret-reference"

export const AUTH_PROVIDER_ID_PATTERN = /^[a-z][a-z0-9_-]*$/
export const CREDENTIAL_AUTH_PROVIDER_ID = "credential"
export const DEFAULT_OIDC_SCOPES = ["openid", "profile", "email", "offline_access"] as const

// oxlint-disable-next-line effect/prefer-schema-class -- deployment config is plain JSON shared by infra and the Worker
export const AuthProviderCapabilitiesSchema = Schema.Struct({
  signIn: Schema.Boolean,
  provisionUsers: Schema.Boolean,
  link: Schema.Boolean,
})
export type AuthProviderCapabilities = typeof AuthProviderCapabilitiesSchema.Type

// oxlint-disable-next-line effect/prefer-schema-class -- deployment config is plain JSON shared by infra and the Worker
export const CredentialAuthProviderConfigSchema = Schema.Struct({
  kind: Schema.Literal("credential"),
  enabled: Schema.Boolean,
  displayName: Schema.String,
  capabilities: AuthProviderCapabilitiesSchema,
  // oxlint-disable-next-line effect/prefer-schema-class -- nested deployment DTO has no class behavior
  provisioning: Schema.Struct({
    scope: Schema.Literal("configured-admins"),
  }),
})
export type CredentialAuthProviderConfig = typeof CredentialAuthProviderConfigSchema.Type

// oxlint-disable-next-line effect/prefer-schema-class -- deployment config is plain JSON shared by infra and the Worker
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

// oxlint-disable-next-line effect/prefer-schema-class -- deployment config is plain JSON shared by infra and the Worker
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

// oxlint-disable-next-line effect/prefer-schema-class -- deployment config is plain JSON shared by infra and the Worker
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

type UrlConstructorWithCanParse = typeof URL & {
  canParse?: (input: string) => boolean
}

function failConfig(message: string): never {
  throw new Error(`Invalid auth configuration: ${message}`)
}

function requireNonEmpty(value: string, field: string): string {
  const normalized = value.trim()
  return normalized || failConfig(`${field} must not be empty`)
}

function normalizeScopes(scopes: readonly string[] | undefined, defaults: readonly string[]) {
  const normalized = [...new Set((scopes ?? defaults).map((scope) => scope.trim()).filter(Boolean))]
  return Match.value(normalized.length > 0).pipe(
    Match.when(true, () => normalized),
    Match.when(false, () => [...defaults]),
    Match.exhaustive,
  )
}

export function normalizeAuthProviderRegistry(value: unknown): AuthProviderRegistry {
  const decoded = Schema.decodeUnknownSync(AuthProviderRegistrySchema)(value)
  const providers = Object.fromEntries(
    Object.entries(decoded.providers).map(([rawProviderId, provider]) => {
      const providerId = rawProviderId.trim().toLowerCase()
      if (!AUTH_PROVIDER_ID_PATTERN.test(providerId)) {
        failConfig(`provider id '${rawProviderId}' must match ${AUTH_PROVIDER_ID_PATTERN}`)
      }
      if (providerId !== rawProviderId) {
        failConfig(`provider id '${rawProviderId}' must already be normalized`)
      }
      if (provider.capabilities.provisionUsers && !provider.capabilities.signIn) {
        failConfig(`provider '${providerId}' cannot provision users without sign-in capability`)
      }

      const common = {
        ...provider,
        displayName: requireNonEmpty(provider.displayName, `providers.${providerId}.displayName`),
      }
      if (provider.kind === "credential") {
        if (providerId !== CREDENTIAL_AUTH_PROVIDER_ID) {
          failConfig(`the credential provider id must be '${CREDENTIAL_AUTH_PROVIDER_ID}'`)
        }
        if (
          provider.enabled &&
          (!provider.capabilities.signIn ||
            !provider.capabilities.provisionUsers ||
            provider.capabilities.link)
        ) {
          failConfig(
            "the credential provider must sign in and provision configured admins, and cannot link",
          )
        }
        return [providerId, common]
      }

      const clientId = requireNonEmpty(provider.clientId, `providers.${providerId}.clientId`)
      const clientSecret = normalizeSecretReference(
        provider.clientSecret,
        `auth.providers.${providerId}.clientSecret`,
      )
      if (provider.kind === "social") {
        return [
          providerId,
          {
            ...common,
            clientId,
            clientSecret,
            scopes: normalizeScopes(provider.scopes, []),
          },
        ]
      }

      const issuer = requireNonEmpty(provider.issuer, `providers.${providerId}.issuer`)
      if ((URL as UrlConstructorWithCanParse).canParse?.(issuer) !== true) {
        failConfig(`providers.${providerId}.issuer must be a valid URL`)
      }
      return [
        providerId,
        {
          ...common,
          clientId,
          clientSecret,
          issuer: new URL(issuer).toString().replace(/\/+$/, ""),
          scopes: normalizeScopes(provider.scopes, DEFAULT_OIDC_SCOPES),
        },
      ]
    }),
  ) as AuthProviderRegistry["providers"]

  const signInProviderIds = Object.entries(providers)
    .filter(([, provider]) => provider.enabled && provider.capabilities.signIn)
    .map(([providerId]) => providerId)
  if (signInProviderIds.length === 0) {
    failConfig("at least one provider must allow sign-in")
  }

  const defaultSignInProviderId = decoded.defaultSignInProviderId.trim().toLowerCase()
  if (!signInProviderIds.includes(defaultSignInProviderId)) {
    failConfig("defaultSignInProviderId must reference an enabled sign-in provider")
  }

  return { defaultSignInProviderId, providers }
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
