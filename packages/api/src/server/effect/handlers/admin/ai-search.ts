import type { AdminAiSearchSourcePayload } from "@solzero/api"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import { exportAiSearchConfig } from "../../../background/ai-search/admin-actions"
import {
  AiSearchRegistryStore,
  type AiSearchInstanceListItem,
  type AiSearchSourceWithPresence,
} from "../../../background/db/ai-search"
import { EffectRequestLogger } from "../../services/observability"
import { describeError, failMessage, json, type ControlPlaneContext } from "../shared/control-plane"

interface AdminIdentity {
  userId: string
  email: string
}

function formatSource(input: AiSearchSourceWithPresence) {
  return {
    id: input.source.id,
    label: input.source.label,
    description: input.source.description,
    enabled: input.source.enabled,
    maxResults: input.source.maxResults,
    dataSource: input.source.dataSource,
    source: input.recordSource,
    locked: input.locked,
    envVarName: input.envVarName,
    createdAt: input.source.createdAt,
    updatedAt: input.source.updatedAt,
  }
}

function formatInstance(instance: AiSearchInstanceListItem) {
  return instance
}

export const getAiSearchAdminResponse = Effect.fn("admin.getAiSearchAdminResponse")(function* (
  context: ControlPlaneContext,
) {
  const registry = new AiSearchRegistryStore(context.env)
  const [sources, instances] = yield* Effect.all(
    [registry.listSourcesWithPresence(), registry.listCloudflareInstances()],
    { concurrency: "unbounded" },
  )
  return {
    sources: sources.map(formatSource),
    instances: instances.map(formatInstance),
    workflowNamespace: {
      binding: "WORKFLOW_AI_SEARCH",
      status: Match.value(Boolean(context.env.WORKFLOW_AI_SEARCH)).pipe(
        Match.when(true, () => "configured" as const),
        Match.orElse(() => "missing" as const),
      ),
      note: "Workflow-managed AI Search instances are tracked in the workflow node pass.",
    },
  }
})

export const performExportAiSearchConfig = Effect.fn("admin.performExportAiSearchConfig")(
  function* (context: ControlPlaneContext, admin: AdminIdentity) {
    const result = yield* exportAiSearchConfig(context.env).pipe(
      Effect.catch((cause) => failMessage(describeError(cause), 500)),
    )
    const log = yield* EffectRequestLogger
    yield* log.emit({
      event: "admin.ai_search.config.exported",
      boundary: "admin.ai_search.config.export",
      admin,
      aiSearch: {
        variableCount: result.variableCount,
        sourceCount: result.sourceCount,
      },
    })
    return json(result)
  },
)

export const performCreateAiSearchSource = Effect.fn("admin.performCreateAiSearchSource")(
  function* (
    context: ControlPlaneContext,
    admin: AdminIdentity,
    payload: AdminAiSearchSourcePayload,
  ) {
    const registry = new AiSearchRegistryStore(context.env)
    const source = yield* registry
      .createSource(payload)
      .pipe(Effect.catch((cause) => failMessage(describeError(cause), 400)))
    const log = yield* EffectRequestLogger
    yield* log.emit({
      event: "admin.ai_search.source.created",
      boundary: "admin.ai_search.source",
      admin,
      aiSearch: {
        sourceId: source.id,
        dataSourceType: source.dataSource.type,
        enabled: source.enabled,
      },
    })
    return json(yield* getAiSearchAdminResponse(context))
  },
)

export const performUpdateAiSearchSource = Effect.fn("admin.performUpdateAiSearchSource")(
  function* (
    context: ControlPlaneContext,
    admin: AdminIdentity,
    sourceId: string,
    payload: AdminAiSearchSourcePayload,
  ) {
    const registry = new AiSearchRegistryStore(context.env)
    const source = yield* registry
      .updateSource(sourceId, payload)
      .pipe(Effect.catch((cause) => failMessage(describeError(cause), 400)))
    const log = yield* EffectRequestLogger
    yield* log.emit({
      event: "admin.ai_search.source.updated",
      boundary: "admin.ai_search.source",
      admin,
      aiSearch: {
        sourceId: source.id,
        dataSourceType: source.dataSource.type,
        enabled: source.enabled,
      },
    })
    return json(yield* getAiSearchAdminResponse(context))
  },
)

export const performDeleteAiSearchSource = Effect.fn("admin.performDeleteAiSearchSource")(
  function* (context: ControlPlaneContext, admin: AdminIdentity, sourceId: string) {
    const registry = new AiSearchRegistryStore(context.env)
    yield* registry
      .deleteSource(sourceId)
      .pipe(Effect.catch((cause) => failMessage(describeError(cause), 400)))
    const log = yield* EffectRequestLogger
    yield* log.emit({
      event: "admin.ai_search.source.deleted",
      boundary: "admin.ai_search.source",
      admin,
      aiSearch: {
        sourceId,
      },
    })
    return json(yield* getAiSearchAdminResponse(context))
  },
)
