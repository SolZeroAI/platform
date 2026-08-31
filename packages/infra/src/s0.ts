import { resolve } from "node:path"
import * as Cloudflare from "alchemy/Cloudflare"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import {
  CLOUDFLARE_AI_GATEWAY_BYOK_PROVIDERS,
  LOCAL_PGLITE_DATABASE_URL,
  type AppDbMode,
  type S0DatabaseEngine,
  type StageMetadata,
} from "@solzero/shared"
import {
  createAgentContainerApplications,
  createAgentContainerNamespaces,
  createAgentResources,
  createApi,
  createDynamicWorkflowResource,
  type ApiAiGatewayBinding,
  type ApiInfraEnv,
  type ApiSecretInput,
} from "../../../apps/api/infra/index"
import type { DeploymentMetadata } from "./deploymentMetadata"
import { createWeb } from "./web"

export interface CreateS0Options {
  appName: string
  stageMetadata: StageMetadata
  deploymentMetadata: DeploymentMetadata
  databaseEngine: S0DatabaseEngine
  appDbMode: AppDbMode
  databaseUrl?: string
  dev: boolean
  cloudflareAccountId: string
  infraDir: string
  repoRoot: string
  apiEnv: ApiInfraEnv
}

export type CreateS0ApiOptions = CreateS0Options

export interface CreateS0WebOptions {
  appName: string
  stageMetadata: StageMetadata
  deploymentMetadata: DeploymentMetadata
  repoRoot: string
  dev: boolean
}

function redactedSecret(value: ApiSecretInput): Redacted.Redacted<string> {
  return Match.value(value).pipe(
    Match.when(Match.string, Redacted.make),
    Match.orElse((output) => output),
  ) as Redacted.Redacted<string>
}

function createCloudflareAiGateway(input: {
  appName: string
  stageMetadata: StageMetadata
  apiEnv: ApiInfraEnv
  cloudflareAccountId: string
}) {
  const config = input.apiEnv.S0_CONFIG_CLOUDFLARE_AI_GATEWAY
  return Effect.gen(function* () {
    // oxlint-disable-next-line s0-lint/no-if-statement -- deployment selection stays adjacent to resource creation so disabled and mock stacks never call the Cloudflare Gateway API.
    if (!config.enabled) return undefined
    // oxlint-disable-next-line s0-lint/no-if-statement -- Alchemy stack tests need the native binding shape without provisioning an account resource.
    if (input.apiEnv.S0_PROVIDER_LAYER === "mock") {
      return {
        resource: Cloudflare.Workers.AI("AI_GATEWAY"),
        gatewayId: `${input.appName}-${input.stageMetadata.name}-ai-gateway`,
        runToken: "local-ai-gateway-run-token",
        secretsStoreId: "local-ai-gateway-secrets-store",
      } satisfies ApiAiGatewayBinding
    }

    const secretsStore = yield* Cloudflare.SecretsStore.Store("ai-gateway-secrets")
    const resource = yield* Cloudflare.AI.Gateway("ai-gateway", {
      authentication: true,
      cacheTtl: config.cacheTtl,
      collectLogs: config.collectLogs,
      storeId: secretsStore.storeId,
    })
    yield* Effect.forEach(
      CLOUDFLARE_AI_GATEWAY_BYOK_PROVIDERS,
      (provider) =>
        Option.match(
          Option.fromNullishOr(input.apiEnv.cloudflareAiGatewayProviderKeySecrets[provider.id]),
          {
            onNone: () => Effect.void,
            onSome: (value) =>
              Cloudflare.AI.ProviderKey(`ai-gateway-${provider.id}-key`, {
                store: secretsStore,
                gatewayId: resource.gatewayId,
                providerSlug: provider.providerSlug,
                value: redactedSecret(value),
                defaultConfig: true,
                comment: `${input.appName} ${input.stageMetadata.name} ${provider.name} default key`,
              }).pipe(Effect.asVoid),
          },
        ),
      { concurrency: "unbounded" },
    )
    const runToken = yield* Cloudflare.ApiToken.AccountApiToken("ai-gateway-run-token", {
      accountId: input.cloudflareAccountId,
      name: `${input.appName}-${input.stageMetadata.name}-ai-gateway-run`,
      policies: [
        {
          effect: "allow",
          permissionGroups: ["AI Gateway Run", "Workers AI Read"],
          resources: {
            [`com.cloudflare.api.account.${input.cloudflareAccountId}`]: "*",
          },
        },
      ],
    })
    return {
      resource,
      gatewayId: resource.gatewayId,
      runToken: runToken.value,
      secretsStoreId: secretsStore.storeId,
    } satisfies ApiAiGatewayBinding
  })
}

export function createS0Api(options: CreateS0ApiOptions) {
  return Effect.gen(function* () {
    const {
      appName,
      stageMetadata,
      deploymentMetadata,
      databaseEngine,
      appDbMode,
      databaseUrl,
      dev,
      cloudflareAccountId,
      infraDir,
      repoRoot,
      apiEnv,
    } = options
    const migrationsDir = resolve(infraDir, "d1-migrations")

    const aiGateway = yield* createCloudflareAiGateway({
      appName,
      stageMetadata,
      apiEnv,
      cloudflareAccountId,
    })
    const agentContainers = createAgentContainerNamespaces()
    const agentContainerApplications = createAgentContainerApplications({
      appName,
      stageMetadata,
      repoRoot,
    })
    const agentResources = yield* createAgentResources({
      appName,
      dev,
      stageMetadata,
      migrationsDir,
      tokenId: apiEnv.CF_AI_SEARCH_SERVICE_TOKEN_ID,
      databaseEngine,
      appDbMode,
      databaseUrl: databaseUrl ?? LOCAL_PGLITE_DATABASE_URL,
    })
    const api = yield* createApi({
      appName,
      stageMetadata,
      deploymentMetadata,
      dev,
      cloudflareAccountId,
      agentContainers,
      agentContainerApplications,
      agentResources,
      aiGateway,
      env: apiEnv,
    })
    const dynamicWorkflow = yield* createDynamicWorkflowResource({
      appName,
      stageMetadata,
      workerName: api.workerName,
    })
    const opencodeAgentContainerApplication = yield* agentContainerApplications.opencode
    const codexAgentContainerApplication = yield* agentContainerApplications.codex
    const claudeCodeAgentContainerApplication = yield* agentContainerApplications.claudeCode

    return {
      agentResources: { ...agentResources, dynamicWorkflow },
      api,
      agentContainers,
      agentContainerApplications: {
        opencode: opencodeAgentContainerApplication,
        codex: codexAgentContainerApplication,
        claudeCode: claudeCodeAgentContainerApplication,
      },
    }
  })
}

export function createS0Web(options: CreateS0WebOptions) {
  return createWeb({
    appName: options.appName,
    stageMetadata: options.stageMetadata,
    deploymentMetadata: options.deploymentMetadata,
    repoRoot: options.repoRoot,
    dev: options.dev,
  })
}

export function createS0(options: CreateS0Options) {
  return Effect.gen(function* () {
    const api = yield* createS0Api(options)
    const web = yield* createS0Web(options)

    return { ...api, web }
  })
}
