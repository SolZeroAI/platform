/* oxlint-disable s0-lint/no-if-statement, s0-lint/no-ternary -- Stage metadata exposes synchronous adapters for browser, Worker, and deployment callers while its Effect constructors remain typed. */
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import type { S0ApplicationConfig, S0DeploymentConfig } from "./s0-config"

const DEFAULT_SANDBOX_INACTIVITY_TIMEOUT_MS = 600_000
const INTERNAL_MCP_LOCAL_ORIGIN = "http://host.docker.internal:1337"
const INTERNAL_MCP_INTERNAL_ORIGIN = "http://s0-ai-search.internal"
const INTERNAL_MCP_INTERNAL_HOST = new URL(INTERNAL_MCP_INTERNAL_ORIGIN).hostname

export interface StageMetadataEnv {
  readonly STAGE: string
  readonly S0_STAGE_METADATA?: unknown
}

export type StageMetadataInput = string | StageMetadataEnv

interface StageInfraConfig {
  readonly zone: Option.Option<string>
  readonly webFqdn: Option.Option<string>
  readonly apiFqdn: Option.Option<string>
  readonly apiObservabilityLogsDestinations: Option.Option<readonly string[]>
  readonly apiObservabilityTracesDestinations: Option.Option<readonly string[]>
  readonly apiObservabilityLogsHeadSamplingRate: Option.Option<number>
  readonly apiObservabilityTracesHeadSamplingRate: Option.Option<number>
  readonly useApiShield: Option.Option<boolean>
}

const EMPTY_STAGE_INFRA_CONFIG: StageInfraConfig = {
  zone: Option.none(),
  webFqdn: Option.none(),
  apiFqdn: Option.none(),
  apiObservabilityLogsDestinations: Option.none(),
  apiObservabilityTracesDestinations: Option.none(),
  apiObservabilityLogsHeadSamplingRate: Option.none(),
  apiObservabilityTracesHeadSamplingRate: Option.none(),
  useApiShield: Option.none(),
}
function nonEmptyStringOption(value: string | undefined): Option.Option<string> {
  return Option.fromNullishOr(value).pipe(
    Option.map((text) => text.trim()),
    Option.filter((text) => text.length > 0),
  )
}

function stageInfraConfigFromDeployment(config: S0DeploymentConfig): StageInfraConfig {
  return {
    zone: nonEmptyStringOption(config.zone),
    webFqdn: nonEmptyStringOption(config.webFqdn),
    apiFqdn: nonEmptyStringOption(config.apiFqdn),
    apiObservabilityLogsDestinations: Option.some(config.observability.logsDestinations),
    apiObservabilityTracesDestinations: Option.some(config.observability.tracesDestinations),
    apiObservabilityLogsHeadSamplingRate: Option.some(config.observability.logsHeadSamplingRate),
    apiObservabilityTracesHeadSamplingRate: Option.some(
      config.observability.tracesHeadSamplingRate,
    ),
    useApiShield: Option.some(config.useApiShield),
  }
}

export interface InfraStageProps {
  readonly zone: string
  /** Public origin for the API / control plane for this stage. */
  readonly serverUrl: string
  /**
   * Public origin Better Auth should use when generating OAuth callbacks and
   * other browser-facing auth URLs. In local dev this is the web app origin,
   * which proxies `/api/auth/*` to the worker.
   */
  readonly authBaseUrl: string
  /**
   * Origins allowed to initiate Better Auth requests for this stage.
   * In local dev, the web app runs on port 3000 and proxies auth traffic to
   * the worker on port 1337.
   */
  readonly authTrustedOrigins: readonly string[]
  /** Custom domains to bind to the API worker for this stage. */
  readonly apiDomains: readonly string[]
  /** Custom domains to bind to the web worker for this stage. */
  readonly webDomains: readonly string[]
  readonly useApiShield: boolean
  /**
   * Origin (scheme + host + optional port) the sandbox container uses to reach
   * the internal MCP handler. In production, outbound Workers intercept
   * the non-resolvable hostname. In dev, the container reaches the wrangler
   * server directly via Docker host networking.
   */
  readonly internalMcpOrigin: string
  /**
   * Hostname the sandbox container should route through the internal MCP
   * outbound handler. Dev uses direct Docker host networking, so there is no
   * host-specific outbound interception to install locally.
   */
  readonly internalMcpOutboundHost: string | null
  /**
   * Whether the API worker should serve the internal MCP route directly. This
   * is only needed for local dev, where the container reaches the worker via
   * host.docker.internal instead of a container outbound handler.
   */
  readonly internalMcpWorkerRouteEnabled: boolean
  /** Cloudflare Workers Logs head sampling rate for the API worker. */
  readonly apiObservabilityLogsHeadSamplingRate: number
  /** Cloudflare Workers Traces head sampling rate for the API worker. */
  readonly apiObservabilityTracesHeadSamplingRate: number
  /** Human-readable API request logs in local dev, machine-readable JSON elsewhere. */
  readonly apiObservabilityLogFormat: "pretty" | "json"
  /** Whether API request logs should be written to the console. */
  readonly apiObservabilityConsoleOutputEnabled: boolean
  /** Cloudflare Workers Observability destinations for exported API logs. */
  readonly apiObservabilityLogsDestinations: readonly string[]
  /** Cloudflare Workers Observability destinations for exported API traces. */
  readonly apiObservabilityTracesDestinations: readonly string[]
}

export interface AppStageProps {
  readonly logLevel: "trace" | "debug"
  readonly sendSlackNotifications: boolean
  readonly slackChannel: string
  readonly sandboxInactivityTimeoutMs: number
  readonly showTestErrorButton: boolean
  readonly betterAuthSessionTransferEnabled: boolean
}

export interface AppStageMetadata {
  readonly name: string
  readonly app: AppStageProps
}

export interface StageProps {
  readonly name: string
  readonly app: AppStageProps
  readonly infra: InfraStageProps
}

// oxlint-disable-next-line effect/prefer-schema-class -- Cloudflare JSON binding contains a plain compiled StageMetadata value
const InfraStagePropsSchema = Schema.Struct({
  zone: Schema.String,
  serverUrl: Schema.String,
  authBaseUrl: Schema.String,
  authTrustedOrigins: Schema.Array(Schema.String),
  apiDomains: Schema.Array(Schema.String),
  webDomains: Schema.Array(Schema.String),
  useApiShield: Schema.Boolean,
  internalMcpOrigin: Schema.String,
  internalMcpOutboundHost: Schema.NullOr(Schema.String),
  internalMcpWorkerRouteEnabled: Schema.Boolean,
  apiObservabilityLogsHeadSamplingRate: Schema.Number,
  apiObservabilityTracesHeadSamplingRate: Schema.Number,
  apiObservabilityLogFormat: Schema.Literals(["pretty", "json"]),
  apiObservabilityConsoleOutputEnabled: Schema.Boolean,
  apiObservabilityLogsDestinations: Schema.Array(Schema.String),
  apiObservabilityTracesDestinations: Schema.Array(Schema.String),
})

// oxlint-disable-next-line effect/prefer-schema-class -- Cloudflare JSON binding contains a plain compiled StageMetadata value
const AppStagePropsSchema = Schema.Struct({
  logLevel: Schema.Literals(["trace", "debug"]),
  sendSlackNotifications: Schema.Boolean,
  slackChannel: Schema.String,
  sandboxInactivityTimeoutMs: Schema.Number,
  showTestErrorButton: Schema.Boolean,
  betterAuthSessionTransferEnabled: Schema.Boolean,
})

const StageMetadataBindingFields = {
  name: Schema.String,
  app: AppStagePropsSchema,
  infra: InfraStagePropsSchema,
}
const StageMetadataBindingSchema = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("dev"), ...StageMetadataBindingFields }),
  Schema.Struct({ _tag: Schema.Literal("test"), ...StageMetadataBindingFields }),
  Schema.Struct({ _tag: Schema.Literal("pre"), ...StageMetadataBindingFields }),
  Schema.Struct({ _tag: Schema.Literal("prod"), ...StageMetadataBindingFields }),
])
const decodeStageMetadataBinding = Schema.decodeUnknownSync(StageMetadataBindingSchema)
type StageMetadataBinding = typeof StageMetadataBindingSchema.Type

function configuredAppStageProps(config: S0ApplicationConfig): AppStageProps {
  return {
    ...config,
    sendSlackNotifications: config.sendSlackNotifications && config.slackChannel.trim().length > 0,
    slackChannel: config.slackChannel.trim(),
  }
}

export type StageMetadata = Dev | Test | Pre | Prod

export class InvalidStageError extends Schema.TaggedErrorClass<InvalidStageError>()(
  "InvalidStageError",
  {
    stage: Schema.String,
    message: Schema.String,
  },
) {}

function invalidStageError(stageStr: string): InvalidStageError {
  return new InvalidStageError({
    stage: stageStr,
    message: `Invalid stage: "${stageStr}". Expected "dev", "test", "prod", "pre", or "pre-*"`,
  })
}

export function getAppStageMetadataFromStr(stageStr: string) {
  const lowerCaseStage = stageStr.toLowerCase()

  return Match.value(lowerCaseStage).pipe(
    Match.when("dev", () =>
      Effect.succeed<AppStageMetadata>({
        name: "dev",
        app: Dev.app,
      }),
    ),
    Match.when("test", () =>
      Effect.succeed<AppStageMetadata>({
        name: "test",
        app: Test.app,
      }),
    ),
    Match.when("prod", () =>
      Effect.succeed<AppStageMetadata>({
        name: "prod",
        app: Prod.app,
      }),
    ),
    Match.when(
      (stage) => stage === "pre" || stage.startsWith("pre-"),
      (stage) =>
        Effect.succeed<AppStageMetadata>({
          name: stage,
          app: Pre.app,
        }),
    ),
    Match.orElse(() => Effect.fail(invalidStageError(stageStr))),
  )
}

export function getAppStageMetadataSync(input: string | StageMetadataEnv) {
  if (typeof input !== "string" && input.S0_STAGE_METADATA !== undefined) {
    const metadata = decodeStageMetadataBinding(input.S0_STAGE_METADATA)
    return { name: metadata.name, app: metadata.app } satisfies AppStageMetadata
  }
  const stage = Match.value(input).pipe(
    Match.when(Match.string, (value) => value),
    Match.orElse((env) => env.STAGE),
  )
  // oxlint-disable-next-line effect/effect-run-in-body -- Sync boundary for browser/runtime feature flags; app metadata is deterministic and does not resolve infra.
  return Effect.runSync(getAppStageMetadataFromStr(stage))
}

function localInfraStageProps(
  config: StageInfraConfig,
  consoleOutputEnabled: boolean,
): InfraStageProps {
  const zone = "localhost"
  const serverUrl = `http://${zone}:1337`
  const authBaseUrl = "http://localhost:3000"

  return {
    zone,
    serverUrl,
    authBaseUrl,
    authTrustedOrigins: [serverUrl, authBaseUrl, "http://127.0.0.1:3000", "http://[::1]:3000"],
    apiDomains: [],
    webDomains: [],
    useApiShield: Option.getOrElse(config.useApiShield, () => false),
    internalMcpOrigin: INTERNAL_MCP_LOCAL_ORIGIN,
    internalMcpOutboundHost: null,
    internalMcpWorkerRouteEnabled: true,
    apiObservabilityLogsHeadSamplingRate: Option.getOrElse(
      config.apiObservabilityLogsHeadSamplingRate,
      () => 1,
    ),
    apiObservabilityTracesHeadSamplingRate: Option.getOrElse(
      config.apiObservabilityTracesHeadSamplingRate,
      () => 1,
    ),
    apiObservabilityLogFormat: "pretty",
    apiObservabilityConsoleOutputEnabled: consoleOutputEnabled,
    apiObservabilityLogsDestinations: Option.getOrElse(
      config.apiObservabilityLogsDestinations,
      () => [],
    ),
    apiObservabilityTracesDestinations: Option.getOrElse(
      config.apiObservabilityTracesDestinations,
      () => [],
    ),
  }
}

function defaultDeployedWebFqdn(input: {
  readonly stageName: string
  readonly zone: string
  readonly prod: boolean
}): string {
  return Match.value(input.prod).pipe(
    Match.when(true, () => `ai.${input.zone}`),
    Match.orElse(() => `ai-${input.stageName}.${input.zone}`),
  )
}

function requireDeployedInfraZone(config: StageInfraConfig): string {
  return Option.getOrThrowWith(
    config.zone,
    () => new Error("deployment.zone is required for deployed stage metadata."),
  )
}

function deployedInfraStageProps(input: {
  readonly stageName: string
  readonly prod: boolean
  readonly config: StageInfraConfig
  readonly defaultLogsHeadSamplingRate: number
  readonly defaultTracesHeadSamplingRate: number
}): InfraStageProps {
  const { config } = input
  const zone = requireDeployedInfraZone(config)
  const defaultWebFqdn = defaultDeployedWebFqdn({
    stageName: input.stageName,
    zone,
    prod: input.prod,
  })
  const webFqdn = Option.getOrElse(config.webFqdn, () => defaultWebFqdn)
  const defaultApiFqdn = `api.${webFqdn}`
  const apiFqdn = Option.getOrElse(config.apiFqdn, () => defaultApiFqdn)
  const serverUrl = `https://${apiFqdn}`
  const authBaseUrl = `https://${webFqdn}`

  return {
    zone,
    serverUrl,
    authBaseUrl,
    authTrustedOrigins: [authBaseUrl],
    apiDomains: [apiFqdn],
    webDomains: [webFqdn],
    useApiShield: Option.getOrElse(config.useApiShield, () => false),
    internalMcpOrigin: INTERNAL_MCP_INTERNAL_ORIGIN,
    internalMcpOutboundHost: INTERNAL_MCP_INTERNAL_HOST,
    internalMcpWorkerRouteEnabled: false,
    apiObservabilityLogsHeadSamplingRate: Option.getOrElse(
      config.apiObservabilityLogsHeadSamplingRate,
      () => input.defaultLogsHeadSamplingRate,
    ),
    apiObservabilityTracesHeadSamplingRate: Option.getOrElse(
      config.apiObservabilityTracesHeadSamplingRate,
      () => input.defaultTracesHeadSamplingRate,
    ),
    apiObservabilityLogFormat: "json",
    apiObservabilityConsoleOutputEnabled: true,
    apiObservabilityLogsDestinations: Option.getOrElse(
      config.apiObservabilityLogsDestinations,
      () => [],
    ),
    apiObservabilityTracesDestinations: Option.getOrElse(
      config.apiObservabilityTracesDestinations,
      () => [],
    ),
  }
}

export class Dev extends Data.TaggedClass("dev")<StageProps> {
  static readonly app = {
    logLevel: "trace",
    sendSlackNotifications: false,
    slackChannel: "",
    sandboxInactivityTimeoutMs: DEFAULT_SANDBOX_INACTIVITY_TIMEOUT_MS,
    showTestErrorButton: true,
    betterAuthSessionTransferEnabled: true,
  } satisfies AppStageProps

  static make(
    config: StageInfraConfig = EMPTY_STAGE_INFRA_CONFIG,
    app: AppStageProps = Dev.app,
  ): Dev {
    return new Dev({
      name: "dev",
      app,
      infra: localInfraStageProps(config, true),
    })
  }
}

export class Test extends Data.TaggedClass("test")<StageProps> {
  static readonly app = {
    logLevel: "trace",
    sendSlackNotifications: false,
    slackChannel: "",
    sandboxInactivityTimeoutMs: DEFAULT_SANDBOX_INACTIVITY_TIMEOUT_MS,
    showTestErrorButton: true,
    betterAuthSessionTransferEnabled: true,
  } satisfies AppStageProps

  static make(
    config: StageInfraConfig = EMPTY_STAGE_INFRA_CONFIG,
    app: AppStageProps = Test.app,
  ): Test {
    return new Test({
      name: "test",
      app,
      infra: localInfraStageProps(config, false),
    })
  }
}

export class Pre extends Data.TaggedClass("pre")<StageProps> {
  static readonly app = {
    logLevel: "debug",
    sendSlackNotifications: false,
    slackChannel: "",
    sandboxInactivityTimeoutMs: DEFAULT_SANDBOX_INACTIVITY_TIMEOUT_MS,
    showTestErrorButton: false,
    betterAuthSessionTransferEnabled: true,
  } satisfies AppStageProps

  static make(
    stageName: string,
    config: StageInfraConfig = EMPTY_STAGE_INFRA_CONFIG,
    app: AppStageProps = Pre.app,
  ): Pre {
    return new Pre({
      name: stageName,
      app,
      infra: deployedInfraStageProps({
        stageName,
        prod: false,
        config,
        defaultLogsHeadSamplingRate: 1,
        defaultTracesHeadSamplingRate: 1,
      }),
    })
  }
}

export class Prod extends Data.TaggedClass("prod")<StageProps> {
  static readonly app = {
    logLevel: "debug",
    sendSlackNotifications: false,
    slackChannel: "",
    sandboxInactivityTimeoutMs: DEFAULT_SANDBOX_INACTIVITY_TIMEOUT_MS,
    showTestErrorButton: false,
    betterAuthSessionTransferEnabled: true,
  } satisfies AppStageProps

  static make(
    config: StageInfraConfig = EMPTY_STAGE_INFRA_CONFIG,
    app: AppStageProps = Prod.app,
  ): Prod {
    return new Prod({
      name: "prod",
      app,
      infra: deployedInfraStageProps({
        stageName: "prod",
        prod: true,
        config,
        defaultLogsHeadSamplingRate: 0.25,
        defaultTracesHeadSamplingRate: 0.1,
      }),
    })
  }
}

export function getStageMetadataFromStr(
  stageStr: string,
  config: StageInfraConfig = EMPTY_STAGE_INFRA_CONFIG,
  application?: S0ApplicationConfig,
) {
  const lowerCaseStage = stageStr.toLowerCase()
  const app = application ? configuredAppStageProps(application) : undefined

  return Match.value(lowerCaseStage).pipe(
    Match.when("dev", () => Effect.succeed<StageMetadata>(Dev.make(config, app))),
    Match.when("test", () => Effect.succeed<StageMetadata>(Test.make(config, app))),
    Match.when("prod", () => Effect.succeed<StageMetadata>(Prod.make(config, app))),
    Match.when(
      (stage) => stage === "pre" || stage.startsWith("pre-"),
      (stage) => Effect.succeed<StageMetadata>(Pre.make(stage, config, app)),
    ),
    Match.orElse(() => Effect.fail(invalidStageError(stageStr))),
  )
}

function stageMetadataFromBinding(binding: StageMetadataBinding): StageMetadata {
  const props = { name: binding.name, app: binding.app, infra: binding.infra }
  return Match.value(binding._tag).pipe(
    Match.when("dev", () => new Dev(props)),
    Match.when("test", () => new Test(props)),
    Match.when("pre", () => new Pre(props)),
    Match.when("prod", () => new Prod(props)),
    Match.exhaustive,
  )
}

export function getStageMetadata(env: StageMetadataEnv) {
  return env.S0_STAGE_METADATA === undefined
    ? getStageMetadataFromStr(env.STAGE)
    : Effect.succeed(stageMetadataFromBinding(decodeStageMetadataBinding(env.S0_STAGE_METADATA)))
}

export function getStageMetadataFromConfig(
  stage: string,
  deployment: S0DeploymentConfig,
  application: S0ApplicationConfig,
) {
  return getStageMetadataFromStr(stage, stageInfraConfigFromDeployment(deployment), application)
}

export function getStageMetadataFromConfigSync(
  stage: string,
  deployment: S0DeploymentConfig,
  application: S0ApplicationConfig,
): StageMetadata {
  // oxlint-disable-next-line effect/effect-run-in-body -- Synchronous compiler boundary for infrastructure and tests.
  return Effect.runSync(getStageMetadataFromConfig(stage, deployment, application))
}

function getStageMetadataFromInput(input: StageMetadataInput) {
  return Match.value(input).pipe(
    Match.when(Match.string, (stage) => getStageMetadataFromStr(stage)),
    Match.orElse((env) => getStageMetadata(env)),
  )
}

export function getStageMetadataSync(input: StageMetadataInput): StageMetadata {
  // oxlint-disable-next-line effect/effect-run-in-body -- Sync boundary: deterministic stage metadata is consumed by non-Effect callers (apps/api entry, web runtime config, infra stacks, tests); converting them to Effect would ripple across those non-Effect surfaces.
  return Effect.runSync(getStageMetadataFromInput(input))
}

/** Public origin for this stage (API / control plane), from compiled stage metadata. */
export function getInfraServerUrl(input: StageMetadataInput): string {
  return getStageMetadataSync(input).infra.serverUrl
}

/** Public origin for the web frontend for this stage. In dev this differs from the API origin. */
export function getWebUrl(input: StageMetadataInput): string {
  return getStageMetadataSync(input).infra.authBaseUrl
}

export function getInternalMcpOrigin(input: StageMetadataInput): string {
  return getStageMetadataSync(input).infra.internalMcpOrigin
}
