/* oxlint-disable c0-lint/avoid-untagged-errors, c0-lint/no-if-statement, c0-lint/no-return-in-arrow, c0-lint/no-ternary, c0-lint/prefer-option-over-null, effect/avoid-direct-json -- JSONC compilation is a synchronous deployment boundary; explicit validation keeps configuration failures path-specific. */
import * as Schema from "effect/Schema"
import { AdminConfigSchema, normalizeAdminConfig, type AdminConfig } from "./admin"
import {
  AuthProviderRegistrySchema,
  normalizeAuthProviderRegistry,
  type AuthProviderRegistry,
} from "./auth"
import { ReasoningEffortSchema } from "./provider-config"
import {
  normalizeSecretReference,
  SecretReferenceSchema,
  type SecretReference,
} from "./secret-reference"

export const C0_CONFIG_SCHEMA_VERSION = 1 as const
export const C0_CONFIG_STAGE_NAMES = ["dev", "test", "pre", "prod"] as const
export type C0ConfigStageName = (typeof C0_CONFIG_STAGE_NAMES)[number]

const SamplingRateSchema = Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 }))

// oxlint-disable-next-line effect/prefer-schema-class -- root deployment configuration is a plain JSON DTO
export const C0DeploymentConfigSchema = Schema.Struct({
  appName: Schema.String,
  zone: Schema.String,
  webFqdn: Schema.optional(Schema.String),
  apiFqdn: Schema.optional(Schema.String),
  useApiShield: Schema.Boolean,
  observability: Schema.Struct({
    logsDestinations: Schema.Array(Schema.String),
    tracesDestinations: Schema.Array(Schema.String),
    logsHeadSamplingRate: SamplingRateSchema,
    tracesHeadSamplingRate: SamplingRateSchema,
  }),
})
export type C0DeploymentConfig = typeof C0DeploymentConfigSchema.Type

// oxlint-disable-next-line effect/prefer-schema-class -- application configuration is a plain JSON DTO
export const C0ApplicationConfigSchema = Schema.Struct({
  logLevel: Schema.Literals(["trace", "debug"]),
  sendSlackNotifications: Schema.Boolean,
  slackChannel: Schema.String,
  sandboxInactivityTimeoutMs: Schema.Number,
  showTestErrorButton: Schema.Boolean,
  betterAuthSessionTransferEnabled: Schema.Boolean,
})
export type C0ApplicationConfig = typeof C0ApplicationConfigSchema.Type

// oxlint-disable-next-line effect/prefer-schema-class -- runtime bootstrap configuration mirrors the existing KV record without persistence metadata
export const C0LitellmConfigSchema = Schema.Struct({
  enabled: Schema.Boolean,
  baseUrl: Schema.String,
  defaultModel: Schema.NullOr(Schema.String),
  defaultReasoningLevel: Schema.NullOr(ReasoningEffortSchema),
  adapterOverrides: Schema.Record(Schema.String, Schema.String),
  apiKey: Schema.optional(SecretReferenceSchema),
})
export type C0LitellmConfig = typeof C0LitellmConfigSchema.Type

// oxlint-disable-next-line effect/prefer-schema-class -- runtime bootstrap configuration mirrors the existing KV record without persistence metadata
export const C0McpcfConfigSchema = Schema.Struct({
  enabled: Schema.Boolean,
  baseUrl: Schema.String,
  userOauthProviderId: Schema.String,
  expectedIssuer: Schema.NullOr(Schema.String),
  authTypeAllowlist: Schema.Array(Schema.String),
  serverBlacklist: Schema.Array(Schema.String),
  adminApiToken: Schema.optional(SecretReferenceSchema),
})
export type C0McpcfConfig = typeof C0McpcfConfigSchema.Type

// oxlint-disable-next-line effect/prefer-schema-class -- integration configuration is a plain JSON DTO
export const C0GitHubAppConfigSchema = Schema.Struct({
  enabled: Schema.Boolean,
  appId: Schema.String,
  clientId: Schema.String,
  slug: Schema.String,
  clientSecret: SecretReferenceSchema,
  privateKey: SecretReferenceSchema,
  webhookSecret: Schema.optional(SecretReferenceSchema),
})
export type C0GitHubAppConfig = typeof C0GitHubAppConfigSchema.Type

// oxlint-disable-next-line effect/prefer-schema-class -- integration configuration is a plain JSON DTO
export const C0SlackConfigSchema = Schema.Struct({
  enabled: Schema.Boolean,
  botToken: SecretReferenceSchema,
})
export type C0SlackConfig = typeof C0SlackConfigSchema.Type

// oxlint-disable-next-line effect/prefer-schema-class -- internal secret declarations are references, never secret values
export const C0SecurityConfigSchema = Schema.Struct({
  betterAuthSecret: SecretReferenceSchema,
  mcpcfProxySigningSecret: SecretReferenceSchema,
  tokenEncryptionKey: SecretReferenceSchema,
  repositorySecretsEncryptionKey: SecretReferenceSchema,
})
export type C0SecurityConfig = typeof C0SecurityConfigSchema.Type

// oxlint-disable-next-line effect/prefer-schema-class -- auth deployment config combines the public provider registry with its credential secret declaration
export const C0AuthConfigSchema = Schema.Struct({
  defaultSignInProviderId: Schema.String,
  providers: AuthProviderRegistrySchema.fields.providers,
  adminPassword: Schema.optional(SecretReferenceSchema),
})
export type C0AuthConfig = typeof C0AuthConfigSchema.Type

const C0ResolvedConfigFields = {
  schemaVersion: Schema.Literal(C0_CONFIG_SCHEMA_VERSION),
  deployment: C0DeploymentConfigSchema,
  application: C0ApplicationConfigSchema,
  admins: AdminConfigSchema,
  auth: C0AuthConfigSchema,
  aiProviders: Schema.Struct({
    litellm: Schema.optional(C0LitellmConfigSchema),
  }),
  mcpcf: Schema.optional(C0McpcfConfigSchema),
  integrations: Schema.Struct({
    githubApp: C0GitHubAppConfigSchema,
    slack: C0SlackConfigSchema,
  }),
  security: C0SecurityConfigSchema,
  aiSearch: Schema.Struct({
    serviceTokenId: Schema.optional(Schema.NullOr(SecretReferenceSchema)),
  }),
} as const

// oxlint-disable-next-line effect/prefer-schema-class -- resolved deployment config crosses infra and Worker JSON boundaries
export const C0ResolvedConfigSchema = Schema.Struct(C0ResolvedConfigFields)
export type C0ResolvedConfig = typeof C0ResolvedConfigSchema.Type

// oxlint-disable-next-line effect/prefer-schema-class -- external JSONC is decoded to a plain DTO used by infra and Worker bindings
export const C0ConfigFileSchema = Schema.Struct({
  $schema: Schema.optional(Schema.String),
  ...C0ResolvedConfigFields,
})
export type C0ConfigFile = typeof C0ConfigFileSchema.Type

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function c0ConfigStageForStage(stage: string): C0ConfigStageName {
  const normalized = stage.trim().toLowerCase()
  if (normalized === "prod") return "prod"
  if (normalized === "test") return "test"
  if (normalized === "pre" || normalized.startsWith("pre-")) return "pre"
  if (normalized === "dev") return "dev"
  throw new Error(
    `Invalid stage '${stage}' for c0 config file selection. Expected dev, test, pre, pre-*, or prod`,
  )
}

export function c0ConfigFileNameForStage(stage: string): string {
  return `${c0ConfigStageForStage(stage)}.config.jsonc`
}

export function c0ConfigPathForStage(stage: string): string {
  return `config/${c0ConfigFileNameForStage(stage)}`
}

function normalizeTextArray(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort()
}

function normalizeOptionalUrl(value: string | null | undefined, path: string): string | null {
  const normalized = value?.trim() ?? ""
  if (!normalized) return null
  try {
    return new URL(normalized).toString().replace(/\/+$/, "")
  } catch {
    throw new Error(`Invalid c0 configuration: ${path} must be a valid URL`)
  }
}

function validateGitHubAppAuthProvider(
  auth: AuthProviderRegistry,
  githubApp: C0GitHubAppConfig,
): void {
  if (!githubApp.enabled) return

  const provider = auth.providers.github
  if (!provider) {
    throw new Error(
      "Invalid c0 configuration: enabled integrations.githubApp requires auth.providers.github",
    )
  }
  if (provider.kind !== "social" || !provider.enabled) {
    throw new Error(
      "Invalid c0 configuration: auth.providers.github must be an enabled social provider when integrations.githubApp is enabled",
    )
  }
  if (!provider.capabilities.link) {
    throw new Error(
      "Invalid c0 configuration: auth.providers.github must allow explicit account linking when integrations.githubApp is enabled",
    )
  }
  if (provider.clientId !== githubApp.clientId) {
    throw new Error(
      "Invalid c0 configuration: auth.providers.github.clientId must match integrations.githubApp.clientId",
    )
  }
  if (provider.clientSecret.env !== githubApp.clientSecret.env) {
    throw new Error(
      "Invalid c0 configuration: auth.providers.github.clientSecret.env must match integrations.githubApp.clientSecret.env",
    )
  }
}

function normalizeResolvedConfig(decoded: C0ResolvedConfig): C0ResolvedConfig {
  const githubApp: C0GitHubAppConfig = {
    ...decoded.integrations.githubApp,
    appId: decoded.integrations.githubApp.appId.trim(),
    clientId: decoded.integrations.githubApp.clientId.trim(),
    slug: decoded.integrations.githubApp.slug.trim(),
    clientSecret: normalizeSecretReference(
      decoded.integrations.githubApp.clientSecret,
      "integrations.githubApp.clientSecret",
    ),
    privateKey: normalizeSecretReference(
      decoded.integrations.githubApp.privateKey,
      "integrations.githubApp.privateKey",
    ),
    ...(decoded.integrations.githubApp.webhookSecret
      ? {
          webhookSecret: normalizeSecretReference(
            decoded.integrations.githubApp.webhookSecret,
            "integrations.githubApp.webhookSecret",
          ),
        }
      : {}),
  }
  const slack = decoded.integrations.slack
  const litellm = decoded.aiProviders.litellm
  const mcpcf = decoded.mcpcf
  const security = decoded.security
  const auth = normalizeAuthProviderRegistry(decoded.auth)
  validateGitHubAppAuthProvider(auth, githubApp)
  const credentialSignInEnabled = Object.values(auth.providers).some(
    (provider) =>
      provider.kind === "credential" && provider.enabled && provider.capabilities.signIn,
  )
  const adminPassword = decoded.auth.adminPassword
    ? normalizeSecretReference(decoded.auth.adminPassword, "auth.adminPassword")
    : undefined
  if (credentialSignInEnabled && !adminPassword) {
    throw new Error(
      "Invalid c0 configuration: auth.adminPassword is required when credential sign-in is enabled",
    )
  }
  const normalized: C0ResolvedConfig = {
    ...decoded,
    deployment: {
      ...decoded.deployment,
      appName: decoded.deployment.appName.trim(),
      zone: decoded.deployment.zone.trim(),
      ...(decoded.deployment.webFqdn === undefined
        ? {}
        : { webFqdn: decoded.deployment.webFqdn.trim() }),
      ...(decoded.deployment.apiFqdn === undefined
        ? {}
        : { apiFqdn: decoded.deployment.apiFqdn.trim() }),
      observability: {
        ...decoded.deployment.observability,
        logsDestinations: normalizeTextArray(decoded.deployment.observability.logsDestinations),
        tracesDestinations: normalizeTextArray(decoded.deployment.observability.tracesDestinations),
      },
    },
    application: {
      ...decoded.application,
      slackChannel: decoded.application.slackChannel.trim(),
    },
    admins: normalizeAdminConfig(decoded.admins),
    auth: {
      ...auth,
      ...(adminPassword ? { adminPassword } : {}),
    },
    aiProviders: litellm
      ? {
          litellm: {
            ...litellm,
            baseUrl: normalizeOptionalUrl(litellm.baseUrl, "aiProviders.litellm.baseUrl") ?? "",
            ...(litellm.apiKey
              ? {
                  apiKey: normalizeSecretReference(litellm.apiKey, "aiProviders.litellm.apiKey"),
                }
              : {}),
          },
        }
      : {},
    ...(mcpcf
      ? {
          mcpcf: {
            ...mcpcf,
            baseUrl: normalizeOptionalUrl(mcpcf.baseUrl, "mcpcf.baseUrl") ?? "",
            expectedIssuer: normalizeOptionalUrl(mcpcf.expectedIssuer, "mcpcf.expectedIssuer"),
            authTypeAllowlist: normalizeTextArray(mcpcf.authTypeAllowlist).map((value) =>
              value.toLowerCase(),
            ),
            serverBlacklist: normalizeTextArray(mcpcf.serverBlacklist),
            ...(mcpcf.adminApiToken
              ? {
                  adminApiToken: normalizeSecretReference(
                    mcpcf.adminApiToken,
                    "mcpcf.adminApiToken",
                  ),
                }
              : {}),
          },
        }
      : {}),
    integrations: {
      githubApp,
      slack: {
        ...slack,
        botToken: normalizeSecretReference(slack.botToken, "integrations.slack.botToken"),
      },
    },
    security: {
      betterAuthSecret: normalizeSecretReference(
        security.betterAuthSecret,
        "security.betterAuthSecret",
      ),
      mcpcfProxySigningSecret: normalizeSecretReference(
        security.mcpcfProxySigningSecret,
        "security.mcpcfProxySigningSecret",
      ),
      tokenEncryptionKey: normalizeSecretReference(
        security.tokenEncryptionKey,
        "security.tokenEncryptionKey",
      ),
      repositorySecretsEncryptionKey: normalizeSecretReference(
        security.repositorySecretsEncryptionKey,
        "security.repositorySecretsEncryptionKey",
      ),
    },
    aiSearch: decoded.aiSearch.serviceTokenId
      ? {
          serviceTokenId: normalizeSecretReference(
            decoded.aiSearch.serviceTokenId,
            "aiSearch.serviceTokenId",
          ),
        }
      : {},
  }
  if (!normalized.deployment.appName) {
    throw new Error("Invalid c0 configuration: deployment.appName must not be empty")
  }
  if (!normalized.deployment.zone) {
    throw new Error("Invalid c0 configuration: deployment.zone must not be empty")
  }
  if (normalized.application.sandboxInactivityTimeoutMs <= 0) {
    throw new Error(
      "Invalid c0 configuration: application.sandboxInactivityTimeoutMs must be positive",
    )
  }
  return normalized
}

export function resolveC0Config(value: unknown): C0ResolvedConfig {
  const decoded = Schema.decodeUnknownSync(C0ConfigFileSchema)(value)
  const { $schema: _schema, ...config } = decoded
  return normalizeResolvedConfig(Schema.decodeUnknownSync(C0ResolvedConfigSchema)(config))
}

function sortForCanonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForCanonicalJson)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortForCanonicalJson(value[key])]),
  )
}

export function canonicalC0ConfigJson(config: C0ResolvedConfig): string {
  return JSON.stringify(sortForCanonicalJson(config))
}

export function c0ConfigSecretReferences(config: C0ResolvedConfig): SecretReference[] {
  const authProviderSecrets = Object.values(config.auth.providers).flatMap((provider) =>
    provider.kind === "credential" ? [] : [provider.clientSecret],
  )
  return [
    ...authProviderSecrets,
    ...(config.aiProviders.litellm?.apiKey ? [config.aiProviders.litellm.apiKey] : []),
    ...(config.mcpcf?.adminApiToken ? [config.mcpcf.adminApiToken] : []),
    config.integrations.githubApp.clientSecret,
    config.integrations.githubApp.privateKey,
    ...(config.integrations.githubApp.webhookSecret
      ? [config.integrations.githubApp.webhookSecret]
      : []),
    config.integrations.slack.botToken,
    ...(config.auth.adminPassword ? [config.auth.adminPassword] : []),
    config.security.betterAuthSecret,
    config.security.mcpcfProxySigningSecret,
    config.security.tokenEncryptionKey,
    config.security.repositorySecretsEncryptionKey,
    ...(config.aiSearch.serviceTokenId ? [config.aiSearch.serviceTokenId] : []),
  ]
}

export function c0RuntimeSecretReferences(config: C0ResolvedConfig): SecretReference[] {
  const credentialSignInEnabled = Object.values(config.auth.providers).some(
    (provider) =>
      provider.kind === "credential" && provider.enabled && provider.capabilities.signIn,
  )
  const authProviderSecrets = Object.values(config.auth.providers).flatMap((provider) =>
    provider.kind !== "credential" && provider.enabled ? [provider.clientSecret] : [],
  )
  return [
    ...authProviderSecrets,
    ...(credentialSignInEnabled && config.auth.adminPassword ? [config.auth.adminPassword] : []),
    ...(config.aiProviders.litellm?.enabled && config.aiProviders.litellm.apiKey
      ? [config.aiProviders.litellm.apiKey]
      : []),
    ...(config.mcpcf?.enabled && config.mcpcf.adminApiToken ? [config.mcpcf.adminApiToken] : []),
  ]
}

export function c0ActiveSecretReferences(config: C0ResolvedConfig): SecretReference[] {
  const githubApp = config.integrations.githubApp
  return [
    ...c0RuntimeSecretReferences(config),
    ...(githubApp.enabled
      ? [
          githubApp.clientSecret,
          githubApp.privateKey,
          ...(githubApp.webhookSecret ? [githubApp.webhookSecret] : []),
        ]
      : []),
    ...(config.integrations.slack.enabled ? [config.integrations.slack.botToken] : []),
    config.security.betterAuthSecret,
    config.security.mcpcfProxySigningSecret,
    config.security.tokenEncryptionKey,
    config.security.repositorySecretsEncryptionKey,
    ...(config.aiSearch.serviceTokenId ? [config.aiSearch.serviceTokenId] : []),
  ]
}

export interface C0RuntimeBootstrapBindings {
  readonly C0_CONFIG_ADMIN: AdminConfig
  readonly C0_CONFIG_AUTH: C0AuthConfig
  readonly C0_CONFIG_LITELLM?: C0LitellmConfig
  readonly C0_CONFIG_MCPCF?: C0McpcfConfig
  readonly C0_DEPLOYMENT_CONFIG_DIGEST: string
}
