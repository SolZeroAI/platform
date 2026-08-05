import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { Input } from "alchemy/Input"
import type { InlineDockerfile } from "alchemy/Docker/Dockerfile"
import * as Cloudflare from "alchemy/Cloudflare"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import type { Success } from "effect/Effect"
import type { StageMetadata } from "@solzero/shared"
import {
  getAiSearchNamespaceName,
  getWorkflowAiSearchNamespaceName,
} from "../../../packages/infra/src/aiSearch"

export function getApiResourceName(appName: string): string {
  return `${appName}-api`
}

export type AgentContainerRuntime = "opencode" | "codex" | "claude-code"

const AGENT_CONTAINER_CLASS_NAMES = {
  opencode: "OpenCodeAgentContainer",
  codex: "CodexAgentContainer",
  "claude-code": "ClaudeCodeAgentContainer",
} satisfies Record<AgentContainerRuntime, string>

const AGENT_CONTAINER_RESOURCE_IDS = {
  opencode: "opencode-agent-container",
  codex: "codex-agent-container",
  "claude-code": "claude-code-agent-container",
} satisfies Record<AgentContainerRuntime, string>

const AGENT_CONTAINER_ENTRYPOINTS = {
  opencode: "opencode.ts",
  codex: "codex.ts",
  "claude-code": "claude-code.ts",
} satisfies Record<AgentContainerRuntime, string>

export const AGENT_CONTAINER_EXTERNAL_PACKAGES = [
  "@ai-sdk/harness-opencode",
  "@ai-sdk/harness-codex",
  "@ai-sdk/harness-claude-code",
] as const

export const DYNAMIC_WORKFLOW_CLASS_NAME = "DynamicUserWorkflow"

export function getDynamicWorkflowName(appName: string, stageName: string): string {
  return `${appName}-dynamic-workflow-${stageName}`
}

export interface CreateAgentContainerOptions {
  appName: string
  stageMetadata: StageMetadata
  repoRoot: string
}

function getAgentContainerDirectory(repoRoot: string): string {
  return resolve(repoRoot, "packages/agent-container")
}

function readAgentContainerDockerfile(repoRoot: string): InlineDockerfile {
  return {
    content: readFileSync(resolve(getAgentContainerDirectory(repoRoot), "Dockerfile"), "utf8"),
  }
}

export function createAgentContainerNamespace(runtime: AgentContainerRuntime) {
  return Cloudflare.DurableObject(`${runtime}-agent`, {
    className: AGENT_CONTAINER_CLASS_NAMES[runtime],
  })
}

export function createAgentContainerApplication(
  options: CreateAgentContainerOptions & { runtime: AgentContainerRuntime },
) {
  const { appName, repoRoot, stageMetadata } = options
  const containerDir = getAgentContainerDirectory(repoRoot)

  return Cloudflare.ContainerPlatform(AGENT_CONTAINER_RESOURCE_IDS[options.runtime], {
    main: resolve(containerDir, "src", AGENT_CONTAINER_ENTRYPOINTS[options.runtime]),
    dockerfile: readAgentContainerDockerfile(repoRoot),
    instanceType: "standard",
    isExternal: true,
    external: [...AGENT_CONTAINER_EXTERNAL_PACKAGES],
    name: `${appName}-${options.runtime}-agent-${stageMetadata.name}`,
    runtime: "node",
  })
}

export function createAgentContainerNamespaces() {
  return {
    opencode: createAgentContainerNamespace("opencode"),
    codex: createAgentContainerNamespace("codex"),
    claudeCode: createAgentContainerNamespace("claude-code"),
  }
}

export function createAgentContainerApplications(options: CreateAgentContainerOptions) {
  return {
    opencode: createAgentContainerApplication({ ...options, runtime: "opencode" }),
    codex: createAgentContainerApplication({ ...options, runtime: "codex" }),
    claudeCode: createAgentContainerApplication({ ...options, runtime: "claude-code" }),
  }
}

export interface CreateAgentResourcesOptions {
  appName: string
  dev: boolean
  stageMetadata: StageMetadata
  migrationsDir: string
  tokenId: string
}

export interface CreateDynamicWorkflowResourceOptions {
  appName: string
  stageMetadata: StageMetadata
  workerName: Input<string>
}

export function createDynamicWorkflowResource(options: CreateDynamicWorkflowResourceOptions) {
  const { appName, stageMetadata, workerName } = options

  return Cloudflare.WorkflowResource("dynamic-workflow", {
    workflowName: getDynamicWorkflowName(appName, stageMetadata.name),
    className: DYNAMIC_WORKFLOW_CLASS_NAME,
    scriptName: workerName,
  })
}

export function createAgentResources(options: CreateAgentResourcesOptions) {
  const { appName, dev, stageMetadata, migrationsDir } = options

  return Effect.gen(function* () {
    const sessionNamespace = Cloudflare.DurableObject("session", {
      className: "SessionDO",
    })
    const isolateSessionNamespace = Cloudflare.DurableObject("iso-session", {
      className: "IsolateSessionAgent",
    })
    const workflowAlarmNamespace = Cloudflare.DurableObject("workflow-alarm", {
      className: "WorkflowAlarmDO",
    })

    const db = yield* Cloudflare.D1.Database("db", {
      name: `${appName}-db-${stageMetadata.name}`,
      migrationsDir,
    })

    const repoCache = yield* Cloudflare.KV.Namespace("repo-cache", {
      title: `${appName}-repo-cache-${stageMetadata.name}`,
    })
    const s0Config = yield* Cloudflare.KV.Namespace("s0-config", {
      title: `${appName}-s0-config-${stageMetadata.name}`,
    })
    const userWorkflowKv = yield* Cloudflare.KV.Namespace("user-workflow-kv", {
      title: `${appName}-user-workflow-kv-${stageMetadata.name}`,
    })
    const workflowSessionResponseCache = yield* Cloudflare.KV.Namespace("wf-sess-resp-cache", {
      title: `${appName}-wf-sess-resp-cache-${stageMetadata.name}`,
    })

    const workflowBucket = yield* Cloudflare.R2.Bucket("workflow-artifacts", {
      name: `${appName}-workflow-artifacts-${stageMetadata.name}`,
    })
    const skillsBucket = yield* Cloudflare.R2.Bucket("skills", {
      name: `${appName}-skills-${stageMetadata.name}`,
    })
    const aiSearchContentBucket = yield* Cloudflare.R2.Bucket("ai-search-content", {
      name: `${appName}-ai-search-content-${stageMetadata.name}`,
    })
    const aiSearchNamespaces = yield* Match.value(dev).pipe(
      Match.when(true, () =>
        Effect.succeed({
          aiSearchNamespace: undefined,
          workflowAiSearchNamespace: undefined,
        }),
      ),
      Match.orElse(() =>
        Effect.all({
          aiSearchNamespace: Cloudflare.AI.SearchNamespace("ai-search-global", {
            name: getAiSearchNamespaceName({
              appName,
              stageName: stageMetadata.name,
            }),
            description: `${appName} global AI Search instances for ${stageMetadata.name}`,
          }),
          workflowAiSearchNamespace: Cloudflare.AI.SearchNamespace("ai-search-workflow", {
            name: getWorkflowAiSearchNamespaceName({
              appName,
              stageName: stageMetadata.name,
            }),
            description: `${appName} workflow AI Search instances for ${stageMetadata.name}`,
          }),
        }),
      ),
    )

    return {
      sessionNamespace,
      isolateSessionNamespace,
      workflowAlarmNamespace,
      db,
      repoCache,
      s0Config,
      userWorkflowKv,
      workflowSessionResponseCache,
      workflowBucket,
      skillsBucket,
      aiSearchContentBucket,
      ...aiSearchNamespaces,
    }
  })
}

export type AgentContainerNamespaces = ReturnType<typeof createAgentContainerNamespaces>
export type AgentContainerApplications = ReturnType<typeof createAgentContainerApplications>
export type AgentResources = Success<ReturnType<typeof createAgentResources>>
