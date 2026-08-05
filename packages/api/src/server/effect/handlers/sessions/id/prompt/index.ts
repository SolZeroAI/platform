import type { ApiEnv } from "infra/types/env"
import type { IdParams, PromptPayload } from "@solzero/api"
import {
  isAgentRuntimeCompatibleWithProvider,
  normalizeModelId,
  parseStoredOpenCodeMcpServers,
  parseStoredSessionTools,
  splitModelId,
  summarizeSessionTools,
  type AgentRuntime,
} from "@solzero/shared"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { buildRuntimeProviderCatalog } from "../../../../../background/provider-catalog"
import { stringifyJson } from "../../../../../lib/json"
import { EffectRequestLogger } from "../../../../services/observability"
import {
  failUnless,
  getSessionStub,
  InternalRequests,
  parsePromptExecutionMode,
  requireSessionAccess,
  runControlPlane,
} from "../../../shared/control-plane"

const validatePromptModel = Effect.fn("sessions.prompt.validateModel")(function* (
  env: ApiEnv,
  actorUserId: string,
  agentRuntime: AgentRuntime,
  model: string,
) {
  const providerCatalog = yield* Effect.tryPromise(() =>
    buildRuntimeProviderCatalog(env, actorUserId),
  )
  const visibleModelIds = new Set(
    providerCatalog.modelOptions.flatMap((group) => group.models.map((item) => item.id)),
  )
  const requestedModel = normalizeModelId(model)
  yield* failUnless(
    visibleModelIds.has(requestedModel),
    `Model '${requestedModel}' is not configured for this user`,
    400,
  )
  const selectedModel = providerCatalog.modelOptions
    .flatMap((group) => group.models)
    .find((item) => item.id === requestedModel)
  const { providerId } = splitModelId(requestedModel)
  yield* failUnless(
    isAgentRuntimeCompatibleWithProvider(agentRuntime, providerId, selectedModel?.providerApi),
    `Model '${requestedModel}' is not compatible with ${agentRuntime} runtime`,
    400,
  )
  return Option.some(requestedModel)
})

export function prompt({ params, payload }: { params: IdParams; payload: PromptPayload }) {
  return runControlPlane(
    Effect.fn("sessions.prompt")(function* ({ request, env, principal }) {
      const access = yield* requireSessionAccess(request, env, principal, params.id)
      const actorUserId = access.userId

      const resolvedModel = yield* Option.match(Option.fromNullishOr(payload.model), {
        onNone: () => Effect.succeed(Option.none<string>()),
        onSome: (model) =>
          validatePromptModel(env, actorUserId, access.session.agent_runtime, model),
      })

      const stub = getSessionStub(env, params.id)
      const executionMode = parsePromptExecutionMode(new URL(request.url))
      const sessionTools = parseStoredSessionTools(access.session.tools_json)
      const customMcpServers = parseStoredOpenCodeMcpServers(access.session.custom_mcp_json)
      const log = yield* EffectRequestLogger
      yield* log.set({
        sessionId: params.id,
        sessionKind: access.session.session_kind,
        agentRuntime: access.session.agent_runtime,
        promptLength: payload.content.length,
        model: Option.getOrNull(resolvedModel),
        reasoningEffort: payload.reasoningEffort ?? null,
        executionMode,
        tools: sessionTools,
        toolsSummary: summarizeSessionTools(sessionTools, { customMcpServers }),
        customMcpServers: Object.keys(customMcpServers),
      })

      const internalRequests = yield* InternalRequests
      return yield* internalRequests.fetch(stub, "http://internal/internal/prompt-async", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyJson({
          content: payload.content,
          authorId: actorUserId,
          source: payload.source ?? "web",
          model: Option.getOrUndefined(resolvedModel),
          reasoningEffort: payload.reasoningEffort,
          executionMode,
          attachments: payload.attachments,
          callbackContext: payload.callbackContext,
        }),
      })
    }),
  )
}
