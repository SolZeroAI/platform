import { tracing as workerTracing } from "cloudflare:workers"
import type { ToolSet } from "ai"
import * as Option from "effect/Option"
// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- isolate turn-surface.ts is a composition root. It builds the control-plane handle for IsolateToolContext.
import { makeControlPlaneFromEnv } from "../../../effect/db/control-plane-db"
// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- isolate turn-surface.ts is a composition root. It builds the tracing layer for IsolateToolContext.
import { makeBackgroundTracingLayer } from "../../observability/tracing"
import type { SessionToolSpec } from "@solzero/shared"
import type { ApiRequestObserver } from "../../../effect/services/observability"
import type { Env } from "../../types"
import {
  buildIsolateSystemPrompt,
  buildIsolateSystemPromptFacts,
} from "../../session/isolate/system"
import type { IsolateModelContext } from "../model"
import { buildResolvedIsolateSkillSources } from "../skills"
import { buildIsolateTools, type IsolateWorkspaceRuntime } from "../tools"
import type { ActiveTurn, IsolateSessionAgentState } from "./types"

const ISOLATE_FALLBACK_SYSTEM_PROMPT =
  "You are a coding assistant running in an isolated Cloudflare Agent session."

/** The parent agent's base system prompt, before feature modules append their sections. */
export function buildIsolateTurnSystemPrompt(input: {
  state: IsolateSessionAgentState
  activeTurn: ActiveTurn | null
}): string {
  return Option.match(Option.fromNullishOr(input.activeTurn?.model), {
    onNone: () => ISOLATE_FALLBACK_SYSTEM_PROMPT,
    onSome: (model) => promptForModel(input, model),
  })
}

function promptForModel(
  input: { state: IsolateSessionAgentState; activeTurn: ActiveTurn | null },
  model: IsolateModelContext,
): string {
  const facts = buildIsolateSystemPromptFacts({
    tools: input.state.tools,
    customMcpServers: input.state.customMcpServers,
  })
  return buildIsolateSystemPrompt({
    runtimeModelId: model.runtimeModelId,
    providerId: model.providerId,
    modelId: model.modelId,
    hasRepoWorkspace: facts.hasRepoWorkspace,
    hasDocs: facts.hasDocs,
    hasWorkflowBuilder: facts.hasWorkflowBuilder,
    customMcpServerNames: input.activeTurn?.customMcpServerNames ?? facts.customMcpServerNames,
    mcpcfMcpServers: input.activeTurn?.mcpcfMcpServers,
  })
}

/** The parent agent's base tool set, before feature modules merge their tools. */
export function buildIsolateTurnTools(input: {
  env: Env
  runtime: IsolateWorkspaceRuntime
  sessionId: string
  userId: string
  selectedTools: SessionToolSpec[]
  createObserver: (path: string, routeBranch: string) => ApiRequestObserver
}): ToolSet {
  return buildIsolateTools({
    env: input.env,
    db: makeControlPlaneFromEnv(input.env),
    runtime: input.runtime,
    sessionId: input.sessionId,
    userId: input.userId,
    selectedTools: input.selectedTools,
    docsRuntimeContext: {
      log: {
        error: (error, context) =>
          input
            .createObserver("docs_search", "isolate-docs-search")
            .log.error(error, { ...context, sessionId: input.sessionId }),
      },
    },
    tracingLayer: makeBackgroundTracingLayer({ tracing: workerTracing }),
  })
}

export function buildIsolateTurnSkills(input: { env: Env; state: IsolateSessionAgentState }) {
  return buildResolvedIsolateSkillSources({
    db: makeControlPlaneFromEnv(input.env),
    tools: input.state.tools,
    skillsBucket: input.env.AGENT_SKILLS,
    userId: input.state.userId,
  })
}
