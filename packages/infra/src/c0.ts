import { resolve } from "node:path"
import * as Effect from "effect/Effect"
import type { StageMetadata } from "@c0-agent/shared"
import {
  createAgentContainerApplications,
  createAgentContainerNamespaces,
  createAgentResources,
  createApi,
  createDynamicWorkflowResource,
  type ApiInfraEnv,
} from "../../../apps/api/infra/index"
import type { DeploymentMetadata } from "./deploymentMetadata"
import { createWeb } from "./web"

export interface CreateC0Options {
  appName: string
  stageMetadata: StageMetadata
  deploymentMetadata: DeploymentMetadata
  dev: boolean
  cloudflareAccountId: string
  infraDir: string
  repoRoot: string
  apiEnv: ApiInfraEnv
}

export type CreateC0ApiOptions = CreateC0Options

export interface CreateC0WebOptions {
  appName: string
  stageMetadata: StageMetadata
  deploymentMetadata: DeploymentMetadata
  repoRoot: string
  dev: boolean
}

export function createC0Api(options: CreateC0ApiOptions) {
  return Effect.gen(function* () {
    const {
      appName,
      stageMetadata,
      deploymentMetadata,
      dev,
      cloudflareAccountId,
      infraDir,
      repoRoot,
      apiEnv,
    } = options
    const migrationsDir = resolve(infraDir, "d1-migrations")

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

export function createC0Web(options: CreateC0WebOptions) {
  return createWeb({
    appName: options.appName,
    stageMetadata: options.stageMetadata,
    deploymentMetadata: options.deploymentMetadata,
    repoRoot: options.repoRoot,
    dev: options.dev,
  })
}

export function createC0(options: CreateC0Options) {
  return Effect.gen(function* () {
    const api = yield* createC0Api(options)
    const web = yield* createC0Web(options)

    return { ...api, web }
  })
}
