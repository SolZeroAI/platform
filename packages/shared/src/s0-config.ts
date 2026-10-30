import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import { AdminConfigSchema, normalizeAdminConfig, type AdminConfig } from "./admin"
import {
  AuthProviderRegistrySchema,
  validateAuthProviderRegistry,
  type AuthProviderRegistry,
  type SocialAuthProviderConfig,
} from "./auth"
import { ConfigValidationError, ensureConfig, invalidS0Config, normalizeUrl } from "./config-error"
import { stringifyJson } from "./json"
import {
  ProviderModelDefinitionSchema,
  ReasoningEffortSchema,
  type ProviderModelDefinition,
} from "./provider-config"
import { type S0DatabaseEngine } from "./database-engine"
import { resolveS0Brand, type S0BrandEnvironment } from "./s0-brand"
import {
  normalizeSecretReference,
  SecretReferenceSchema,
  type SecretReference,
} from "./secret-reference"

export const S0_CONFIG_SCHEMA_VERSION = 1 as const
export const S0_CONFIG_STAGE_NAMES = ["dev", "test", "pre", "prod"] as const

export type S0ConfigStageName = (typeof S0_CONFIG_STAGE_NAMES)[number]

export type { S0DatabaseEngine }

const SamplingRateSchema = Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 }))

export const S0BrandConfigSchema = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1)),
  logoLightPath: Schema.String.check(Schema.isMinLength(1)),
  logoDarkPath: Schema.String.check(Schema.isMinLength(1)),
  faviconPath: Schema.String.check(Schema.isMinLength(1)),
  appleTouchIconPath: Schema.String.check(Schema.isMinLength(1)),
})

export type S0BrandConfig = typeof S0BrandConfigSchema.Type

export const S0PlanetscaleConfigSchema = Schema.Struct({
  clusterSize: Schema.String.check(Schema.isPattern(/^[A-Z0-9]+(?:[_-][A-Z0-9]+)*$/)),
  logicalDatabaseName: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_]{0,62}$/)),
  region: Schema.optional(Schema.String.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/))),
  arch: Schema.optional(Schema.Literals(["x86", "arm"])),
  replicas: Schema.optional(
    Schema.Union([
      Schema.Literal(0),
      Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(2)),
    ]),
  ),
  majorVersion: Schema.optional(Schema.String.check(Schema.isPattern(/^[0-9]+$/))),
})

export type S0PlanetscaleConfig = typeof S0PlanetscaleConfigSchema.Type

export const DEFAULT_PLANETSCALE_CONFIG: S0PlanetscaleConfig = {
  clusterSize: "PS_10",
  logicalDatabaseName: "s0",
}

function normalizeS0Brand(brand: S0BrandConfig): S0BrandConfig {
  return Schema.decodeUnknownSync(S0BrandConfigSchema)(
    Object.fromEntries(Object.entries(brand).map(([key, value]) => [key, value.trim()])),
  )
}

export const S0DeploymentConfigSchema = Schema.Struct({
  appName: Schema.String,
  zone: Schema.String,
  webFqdn: Schema.optional(Schema.String),
  useApiShield: Schema.Boolean,
  planetscale: Schema.optional(S0PlanetscaleConfigSchema),
  observability: Schema.Struct({
    logsDestinations: Schema.Array(Schema.String),
    tracesDestinations: Schema.Array(Schema.String),
    logsHeadSamplingRate: SamplingRateSchema,
    tracesHeadSamplingRate: SamplingRateSchema,
  }),
})

export type S0DeploymentConfig = typeof S0DeploymentConfigSchema.Type

export const S0ApplicationConfigSchema = Schema.Struct({
  logLevel: Schema.Literals(["trace", "debug"]),
  sendSlackNotifications: Schema.Boolean,
  slackChannel: Schema.String,
  sandboxInactivityTimeoutMs: Schema.Number,
  showTestErrorButton: Schema.Boolean,
  betterAuthSessionTransferEnabled: Schema.Boolean,
})

export type S0ApplicationConfig = typeof S0ApplicationConfigSchema.Type

export const S0LitellmConfigSchema = Schema.Struct({
  enabled: Schema.Boolean,
  baseUrl: Schema.String,
  defaultModel: Schema.NullOr(Schema.String),
  defaultReasoningLevel: Schema.NullOr(ReasoningEffortSchema),
  adapterOverrides: Schema.Record(Schema.String, Schema.String),
  apiKey: Schema.optional(SecretReferenceSchema),
})

export type S0LitellmConfig = typeof S0LitellmConfigSchema.Type

export const S0CloudflareAiGatewayConfigSchema = Schema.Struct({
  enabled: Schema.Boolean,
  cacheTtl: Schema.NullOr(Schema.Number),
  collectLogs: Schema.Boolean,
  defaultModel: Schema.String,
  models: Schema.Record(Schema.String, ProviderModelDefinitionSchema),
  providerKeys: Schema.optional(
    Schema.Struct({
      openai: Schema.optional(SecretReferenceSchema),
      anthropic: Schema.optional(SecretReferenceSchema),
      xai: Schema.optional(SecretReferenceSchema),
    }),
  ),
})

export type S0CloudflareAiGatewayConfig = typeof S0CloudflareAiGatewayConfigSchema.Type

export const S0McpcfConfigSchema = Schema.Struct({
  enabled: Schema.Boolean,
  baseUrl: Schema.String,
  userOauthProviderId: Schema.String,
  expectedIssuer: Schema.NullOr(Schema.String),
  authTypeAllowlist: Schema.Array(Schema.String),
  serverBlacklist: Schema.Array(Schema.String),
  adminApiToken: Schema.optional(SecretReferenceSchema),
})

export type S0McpcfConfig = typeof S0McpcfConfigSchema.Type

export const S0GitHubAppConfigSchema = Schema.Struct({
  enabled: Schema.Boolean,
  appId: Schema.String,
  clientId: Schema.String,
  slug: Schema.String,
  createPullRequestCommand: Schema.optional(
    Schema.String.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), Schema.isMaxLength(64)),
  ),
  clientSecret: SecretReferenceSchema,
  privateKey: SecretReferenceSchema,
  webhookSecret: Schema.optional(SecretReferenceSchema),
})

export type S0GitHubAppConfig = typeof S0GitHubAppConfigSchema.Type

export const S0SlackConfigSchema = Schema.Struct({
  enabled: Schema.Boolean,
  botToken: SecretReferenceSchema,
})

export type S0SlackConfig = typeof S0SlackConfigSchema.Type

export const S0SecurityConfigSchema = Schema.Struct({
  betterAuthSecret: SecretReferenceSchema,
  mcpcfProxySigningSecret: SecretReferenceSchema,
  tokenEncryptionKey: SecretReferenceSchema,
  repositorySecretsEncryptionKey: SecretReferenceSchema,
})

export type S0SecurityConfig = typeof S0SecurityConfigSchema.Type

export const S0AuthConfigSchema = Schema.Struct({
  defaultSignInProviderId: Schema.String,
  providers: AuthProviderRegistrySchema.fields.providers,
  adminPassword: Schema.optional(SecretReferenceSchema),
})

export type S0AuthConfig = typeof S0AuthConfigSchema.Type

const S0ResolvedConfigFields = {
  schemaVersion: Schema.Literal(S0_CONFIG_SCHEMA_VERSION),
  // "mock" answers Workers AI locally and provisions no account AI Gateway. Local e2e only.
  aiGatewayLayer: Schema.optional(Schema.Literals(["live", "mock"])),
  deployment: S0DeploymentConfigSchema,
  application: S0ApplicationConfigSchema,
  admins: AdminConfigSchema,
  auth: S0AuthConfigSchema,
  aiProviders: Schema.Struct({
    cloudflareAiGateway: S0CloudflareAiGatewayConfigSchema,
    litellm: Schema.optional(S0LitellmConfigSchema),
  }),
  mcpcf: Schema.optional(S0McpcfConfigSchema),
  integrations: Schema.Struct({
    githubApp: S0GitHubAppConfigSchema,
    slack: S0SlackConfigSchema,
  }),
  security: S0SecurityConfigSchema,
  aiSearch: Schema.Struct({
    serviceTokenId: Schema.optional(Schema.NullOr(SecretReferenceSchema)),
  }),
} as const

export const S0ResolvedConfigSchema = Schema.Struct({
  ...S0ResolvedConfigFields,
  brand: S0BrandConfigSchema,
})

export type S0ResolvedConfig = typeof S0ResolvedConfigSchema.Type

export const S0ConfigFileSchema = Schema.Struct({
  $schema: Schema.optional(Schema.String),
  ...S0ResolvedConfigFields,
  brand: Schema.optional(S0BrandConfigSchema),
})

export type S0ConfigFile = typeof S0ConfigFileSchema.Type

/**
 * Effect 4 leaves structs open by default (`onExcessProperty: "ignore"`).
 * Operator config keeps the closed contract: unknown keys fail decode and
 * the generated editor schema emits `additionalProperties: false`.
 */
export const S0_CONFIG_JSON_SCHEMA_OPTIONS = {
  onExcessProperty: "error",
} as const

const S0_CONFIG_PROFILE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function s0ConfigStageForStage(stage: string): S0ConfigStageName {
  return Match.value(stage.trim().toLowerCase()).pipe(
    Match.when(
      (normalized) => normalized.startsWith("pre-"),
      (): S0ConfigStageName => "pre",
    ),
    Match.when(Match.is(...S0_CONFIG_STAGE_NAMES), (normalized) => normalized),
    Match.option,
    Result.fromOption(
      () =>
        new ConfigValidationError({
          message: `Invalid stage '${stage}' for s0 config file selection. Expected dev, test, pre, pre-*, or prod`,
        }),
    ),
    // oxlint-disable-next-line effect/avoid-option-getorthrow -- Synchronous boundary for non-Effect callers: invalid input throws the typed error by contract.
    Result.getOrThrow,
  )
}

function s0ConfigProfilePrefix(profile: string | undefined): string {
  return Match.value(profile?.trim().toLowerCase() ?? "").pipe(
    Match.when("", () => Result.succeed("")),
    Match.when(
      (normalized) => S0_CONFIG_PROFILE_PATTERN.test(normalized),
      (normalized) => Result.succeed(`${normalized}-`),
    ),
    Match.orElse(() =>
      Result.fail(
        new ConfigValidationError({
          message: `Invalid s0 config profile '${profile}'. Expected lowercase letters, numbers, and hyphens`,
        }),
      ),
    ),
    // oxlint-disable-next-line effect/avoid-option-getorthrow -- Synchronous boundary for non-Effect callers: invalid input throws the typed error by contract.
    Result.getOrThrow,
  )
}

export function s0ConfigFileNameForStage(stage: string, profile?: string): string {
  return `${s0ConfigProfilePrefix(profile)}${s0ConfigStageForStage(stage)}.config.jsonc`
}

export function s0ConfigPathForStage(stage: string, profile?: string): string {
  return `config/${s0ConfigFileNameForStage(stage, profile)}`
}

function normalizeTextArray(values: readonly string[]): string[] {
  return [
    ...new Set(
      values.flatMap((value) =>
        Match.value(value.trim()).pipe(
          Match.when("", () => []),
          Match.orElse((trimmed) => [trimmed]),
        ),
      ),
    ),
  ].sort()
}

/** A blank URL is absent. A present URL must parse, and loses its trailing slashes. */
function normalizeOptionalUrl(value: string | null | undefined, path: string) {
  return Option.match(Option.liftPredicate(value?.trim() ?? "", Boolean), {
    onNone: () => Result.succeedNone,
    onSome: (url) =>
      normalizeUrl(url, () => invalidS0Config(`${path} must be a valid URL`)).pipe(
        Result.map(Option.some),
      ),
  })
}

function normalizeOptionalSecret(value: SecretReference | null | undefined, path: string) {
  return Option.match(Option.fromNullishOr(value), {
    onNone: () => Result.succeed(undefined),
    onSome: (reference) => normalizeSecretReference(reference, path),
  })
}

const normalizeCloudflareAiGatewayConfig = (config: S0CloudflareAiGatewayConfig) =>
  Result.gen(function* () {
    yield* ensureConfig(
      config.cacheTtl === null || (Number.isFinite(config.cacheTtl) && config.cacheTtl > 0),
      () =>
        invalidS0Config(
          "aiProviders.cloudflareAiGateway.cacheTtl must be null or a positive number of seconds",
        ),
    )

    const entries = Object.entries(config.models).map(
      ([modelId, model]) => [modelId.trim(), { ...model, name: model.name.trim() }] as const,
    )

    yield* Result.all(
      entries.map(([modelId], index) =>
        ensureConfig(modelId !== "", () =>
          invalidS0Config("aiProviders.cloudflareAiGateway model ids must be non-empty"),
        ).pipe(
          Result.andThen(
            ensureConfig(entries.findIndex(([other]) => other === modelId) === index, () =>
              invalidS0Config(`duplicate aiProviders.cloudflareAiGateway model '${modelId}'`),
            ),
          ),
        ),
      ),
    )

    const models: Record<string, ProviderModelDefinition> = Object.fromEntries(entries)
    const defaultModel = config.defaultModel.trim()

    yield* ensureConfig(!config.enabled || entries.length > 0, () =>
      invalidS0Config("enabled aiProviders.cloudflareAiGateway requires at least one model"),
    )

    yield* ensureConfig(!config.enabled || defaultModel !== "", () =>
      invalidS0Config("enabled aiProviders.cloudflareAiGateway requires a defaultModel"),
    )

    yield* ensureConfig(defaultModel === "" || Object.hasOwn(models, defaultModel), () =>
      invalidS0Config(
        `aiProviders.cloudflareAiGateway.defaultModel '${defaultModel}' is not in models`,
      ),
    )

    return { ...config, defaultModel, models }
  })

const validateGitHubAppAuthProvider = (auth: AuthProviderRegistry, githubApp: S0GitHubAppConfig) =>
  Result.gen(function* () {
    const provider = yield* Result.fromNullishOr(auth.providers.github, () =>
      invalidS0Config("enabled integrations.githubApp requires auth.providers.github"),
    )

    const social = yield* Result.liftPredicate(
      provider,
      (candidate): candidate is SocialAuthProviderConfig =>
        candidate.kind === "social" && candidate.enabled,
      () =>
        invalidS0Config(
          "auth.providers.github must be an enabled social provider when integrations.githubApp is enabled",
        ),
    )

    yield* ensureConfig(social.capabilities.link, () =>
      invalidS0Config(
        "auth.providers.github must allow explicit account linking when integrations.githubApp is enabled",
      ),
    )

    yield* ensureConfig(social.clientId === githubApp.clientId, () =>
      invalidS0Config("auth.providers.github.clientId must match integrations.githubApp.clientId"),
    )

    yield* ensureConfig(social.clientSecret.env === githubApp.clientSecret.env, () =>
      invalidS0Config(
        "auth.providers.github.clientSecret.env must match integrations.githubApp.clientSecret.env",
      ),
    )
  })

const normalizeGitHubAppConfig = (githubApp: S0GitHubAppConfig) =>
  Result.gen(function* () {
    return {
      ...githubApp,
      appId: githubApp.appId.trim(),
      clientId: githubApp.clientId.trim(),
      slug: githubApp.slug.trim(),
      clientSecret: yield* normalizeSecretReference(
        githubApp.clientSecret,
        "integrations.githubApp.clientSecret",
      ),
      privateKey: yield* normalizeSecretReference(
        githubApp.privateKey,
        "integrations.githubApp.privateKey",
      ),
      webhookSecret: yield* normalizeOptionalSecret(
        githubApp.webhookSecret,
        "integrations.githubApp.webhookSecret",
      ),
    }
  })

const normalizeLitellmConfig = (litellm: S0LitellmConfig) =>
  Result.gen(function* () {
    const baseUrl = yield* normalizeOptionalUrl(litellm.baseUrl, "aiProviders.litellm.baseUrl")

    return {
      ...litellm,
      baseUrl: Option.getOrElse(baseUrl, () => ""),
      apiKey: yield* normalizeOptionalSecret(litellm.apiKey, "aiProviders.litellm.apiKey"),
    }
  })

const normalizeMcpcfConfig = (mcpcf: S0McpcfConfig) =>
  Result.gen(function* () {
    const baseUrl = yield* normalizeOptionalUrl(mcpcf.baseUrl, "mcpcf.baseUrl")
    const expectedIssuer = yield* normalizeOptionalUrl(mcpcf.expectedIssuer, "mcpcf.expectedIssuer")

    return {
      ...mcpcf,
      baseUrl: Option.getOrElse(baseUrl, () => ""),
      expectedIssuer: Option.getOrNull(expectedIssuer),
      authTypeAllowlist: normalizeTextArray(mcpcf.authTypeAllowlist).map((value) =>
        value.toLowerCase(),
      ),
      serverBlacklist: normalizeTextArray(mcpcf.serverBlacklist),
      adminApiToken: yield* normalizeOptionalSecret(mcpcf.adminApiToken, "mcpcf.adminApiToken"),
    }
  })

const normalizeOptionalConfig = <A, B>(
  value: A | undefined,
  normalize: (config: A) => Result.Result<B, ConfigValidationError>,
) =>
  Option.match(Option.fromUndefinedOr(value), {
    onNone: () => Result.succeed(undefined),
    onSome: normalize,
  })

/** True when an enabled credential provider allows sign-in. */
export const credentialSignInEnabled = (auth: AuthProviderRegistry) =>
  Object.values(auth.providers).some(
    (provider) =>
      provider.kind === "credential" && provider.enabled && provider.capabilities.signIn,
  )

const normalizeResolvedConfig = (decoded: S0ResolvedConfig) =>
  Result.gen(function* () {
    const githubApp = yield* normalizeGitHubAppConfig(decoded.integrations.githubApp)

    const cloudflareAiGateway = yield* normalizeCloudflareAiGatewayConfig(
      decoded.aiProviders.cloudflareAiGateway,
    )

    const auth = yield* validateAuthProviderRegistry(decoded.auth)

    yield* Option.match(
      Option.liftPredicate(githubApp, (app) => app.enabled),
      {
        onNone: () => Result.void,
        onSome: (app) => validateGitHubAppAuthProvider(auth, app),
      },
    )

    const adminPassword = yield* normalizeOptionalSecret(
      decoded.auth.adminPassword,
      "auth.adminPassword",
    )

    yield* ensureConfig(!credentialSignInEnabled(auth) || adminPassword !== undefined, () =>
      invalidS0Config("auth.adminPassword is required when credential sign-in is enabled"),
    )

    const litellm = yield* normalizeOptionalConfig(
      decoded.aiProviders.litellm,
      normalizeLitellmConfig,
    )

    const mcpcf = yield* normalizeOptionalConfig(decoded.mcpcf, normalizeMcpcfConfig)
    const { slack } = decoded.integrations
    const { security } = decoded

    const normalized: S0ResolvedConfig = {
      ...decoded,
      brand: normalizeS0Brand(decoded.brand),
      deployment: {
        ...decoded.deployment,
        appName: decoded.deployment.appName.trim(),
        zone: decoded.deployment.zone.trim(),
        webFqdn: decoded.deployment.webFqdn?.trim(),
        observability: {
          ...decoded.deployment.observability,
          logsDestinations: normalizeTextArray(decoded.deployment.observability.logsDestinations),
          tracesDestinations: normalizeTextArray(
            decoded.deployment.observability.tracesDestinations,
          ),
        },
      },
      application: {
        ...decoded.application,
        slackChannel: decoded.application.slackChannel.trim(),
      },
      admins: normalizeAdminConfig(decoded.admins),
      auth: { ...auth, adminPassword },
      aiProviders: { cloudflareAiGateway, litellm },
      mcpcf,
      integrations: {
        githubApp,
        slack: {
          ...slack,
          botToken: yield* normalizeSecretReference(slack.botToken, "integrations.slack.botToken"),
        },
      },
      security: yield* Result.all({
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
      }),
      aiSearch: {
        serviceTokenId: yield* normalizeOptionalSecret(
          decoded.aiSearch.serviceTokenId,
          "aiSearch.serviceTokenId",
        ),
      },
    }

    yield* ensureConfig(normalized.deployment.appName !== "", () =>
      invalidS0Config("deployment.appName must not be empty"),
    )

    yield* ensureConfig(normalized.deployment.zone !== "", () =>
      invalidS0Config("deployment.zone must not be empty"),
    )

    yield* ensureConfig(normalized.application.sandboxInactivityTimeoutMs > 0, () =>
      invalidS0Config("application.sandboxInactivityTimeoutMs must be positive"),
    )

    return normalized
  })

export function resolveS0Config(
  value: unknown,
  brandEnvironment: S0BrandEnvironment = {},
): S0ResolvedConfig {
  const decoded = Schema.decodeUnknownSync(S0ConfigFileSchema, S0_CONFIG_JSON_SCHEMA_OPTIONS)(value)
  const { $schema: _schema, ...config } = decoded

  // oxlint-disable-next-line effect/avoid-option-getorthrow -- Synchronous boundary for non-Effect callers: invalid input throws the typed error by contract.
  return Result.getOrThrow(
    normalizeResolvedConfig(
      Schema.decodeUnknownSync(
        S0ResolvedConfigSchema,
        S0_CONFIG_JSON_SCHEMA_OPTIONS,
      )({
        ...config,
        brand: config.brand ?? resolveS0Brand(brandEnvironment),
      }),
    ),
  )
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

function sortForCanonicalJson(value: unknown): unknown {
  return Match.value(value).pipe(
    Match.when(Array.isArray, (items: readonly unknown[]) => items.map(sortForCanonicalJson)),
    Match.when(isRecord, (record) =>
      Object.fromEntries(
        Object.keys(record)
          .sort()
          .map((key) => [key, sortForCanonicalJson(record[key])]),
      ),
    ),
    Match.orElse((other) => other),
  )
}

export function canonicalS0ConfigJson(config: S0ResolvedConfig): string {
  return stringifyJson(sortForCanonicalJson(config))
}

/** The references that are set, or none when `enabled` is false. */
const enabledSecrets = (
  enabled: boolean | undefined,
  ...references: ReadonlyArray<SecretReference | null | undefined>
): SecretReference[] =>
  references.filter(
    (reference): reference is SecretReference => enabled === true && reference != null,
  )

export function s0RuntimeSecretReferences(config: S0ResolvedConfig): SecretReference[] {
  const authProviderSecrets = Object.values(config.auth.providers).flatMap((provider) =>
    Match.value(provider).pipe(
      Match.when({ kind: "credential" }, () => []),
      Match.orElse((client) => enabledSecrets(client.enabled, client.clientSecret)),
    ),
  )

  const { litellm } = config.aiProviders

  return [
    ...authProviderSecrets,
    ...enabledSecrets(credentialSignInEnabled(config.auth), config.auth.adminPassword),
    ...enabledSecrets(litellm?.enabled, litellm?.apiKey),
    ...enabledSecrets(config.mcpcf?.enabled, config.mcpcf?.adminApiToken),
  ]
}

export function s0ActiveSecretReferences(config: S0ResolvedConfig): SecretReference[] {
  const { githubApp, slack } = config.integrations
  const { cloudflareAiGateway } = config.aiProviders

  return [
    ...s0RuntimeSecretReferences(config),
    ...enabledSecrets(
      cloudflareAiGateway.enabled,
      ...Object.values(cloudflareAiGateway.providerKeys ?? {}),
    ),
    ...enabledSecrets(
      githubApp.enabled,
      githubApp.clientSecret,
      githubApp.privateKey,
      githubApp.webhookSecret,
    ),
    ...enabledSecrets(slack.enabled, slack.botToken),
    config.security.betterAuthSecret,
    config.security.mcpcfProxySigningSecret,
    config.security.tokenEncryptionKey,
    config.security.repositorySecretsEncryptionKey,
    ...enabledSecrets(true, config.aiSearch.serviceTokenId),
  ]
}

export interface S0RuntimeBootstrapBindings {
  readonly S0_CONFIG_FILE: string
  readonly S0_CONFIG_ADMIN: AdminConfig
  readonly S0_CONFIG_AUTH: S0AuthConfig
  readonly S0_CONFIG_CLOUDFLARE_AI_GATEWAY: S0CloudflareAiGatewayConfig
  readonly S0_CONFIG_LITELLM?: S0LitellmConfig
  readonly S0_CONFIG_MCPCF?: S0McpcfConfig
  readonly S0_DEPLOYMENT_CONFIG_DIGEST: string
}
