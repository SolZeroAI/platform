import type { AdminLitellmConfigPayload } from "@solzero/api"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { getCloudflareAiGatewaySnapshot } from "../../../background/ai-providers/cloudflare-ai-gateway"
import {
  getLitellmProviderSnapshot,
  syncLitellmModels as runLitellmModelSync,
  updateLitellmProviderConfig,
} from "../../../background/ai-providers/litellm"
import {
  exportLitellmProviderConfig,
  resetLitellmProviderConfig,
} from "../../../background/ai-providers/litellm-admin-actions"
import type { LitellmProviderSnapshot } from "../../../background/ai-providers/litellm-types"
import { EffectRequestLogger } from "../../services/observability"
import {
  describeError,
  failMessage,
  failWhen,
  json,
  type ControlPlaneContext,
} from "../shared/control-plane"

interface AdminIdentity {
  userId: string
  email: string
}

function formatLitellmSnapshot(snapshot: LitellmProviderSnapshot) {
  return {
    configured: snapshot.configured,
    config: {
      enabled: snapshot.config.enabled,
      baseUrl: snapshot.config.baseUrl,
      defaultModel: snapshot.config.defaultModel,
      defaultReasoningLevel: snapshot.config.defaultReasoningLevel,
      adapterOverrides: snapshot.config.adapterOverrides,
      source: snapshot.configSource,
      locked: snapshot.configLocked,
      envVarName: snapshot.configEnvVarName,
      apiKeyConfigured: snapshot.apiKeyConfigured,
      apiKeySource: snapshot.apiKeySource,
      apiKeyLocked: snapshot.apiKeyLocked,
      apiKeyEnvVarName: snapshot.apiKeyEnvVarName,
      updatedAt: snapshot.config.updatedAt || null,
    },
    registry: snapshot.registry,
    registrySource: snapshot.registrySource,
    registryLocked: snapshot.registryLocked,
    registryEnvVarName: snapshot.registryEnvVarName,
    cronStatus: snapshot.cronStatus,
  }
}

function formatCloudflareAiGateway(context: ControlPlaneContext) {
  return Option.match(getCloudflareAiGatewaySnapshot(context.env), {
    onNone: () => ({
      enabled: false,
      bindingConfigured: false,
      gatewayId: null,
      cacheTtl: null,
      collectLogs: false,
      defaultModel: null,
      models: {},
    }),
    onSome: ({ bindingConfigured, config, gatewayId }) => ({
      enabled: config.enabled,
      bindingConfigured,
      gatewayId: Option.getOrNull(gatewayId),
      cacheTtl: config.cacheTtl,
      collectLogs: config.collectLogs,
      defaultModel: config.defaultModel || null,
      models: Object.fromEntries(
        Object.entries(config.models).map(([id, model]) => [
          id,
          {
            id,
            name: model.name,
            description: model.description ?? "",
            reasoningEfforts: [...(model.reasoning?.efforts ?? [])],
            defaultReasoningEffort: model.reasoning?.default ?? null,
          },
        ]),
      ),
    }),
  })
}

export const getAiProvidersAdminResponse = Effect.fn("admin.getAiProvidersAdminResponse")(
  function* (context: ControlPlaneContext) {
    const litellm = yield* getLitellmProviderSnapshot(context.env)
    return {
      cloudflareAiGateway: formatCloudflareAiGateway(context),
      litellm: formatLitellmSnapshot(litellm),
    }
  },
)

export const performUpdateLitellmProvider = Effect.fn("admin.performUpdateLitellmProvider")(
  function* (
    context: ControlPlaneContext,
    admin: AdminIdentity,
    payload: AdminLitellmConfigPayload,
  ) {
    const apiKey = payload.apiKey?.trim()
    yield* failWhen(
      Boolean(apiKey) && !context.env.REPO_SECRETS_ENCRYPTION_KEY,
      "Global secret encryption is not configured",
      500,
    )
    const config = yield* updateLitellmProviderConfig(context.env, {
      enabled: payload.enabled,
      baseUrl: payload.baseUrl,
      defaultModel: payload.defaultModel ?? null,
      defaultReasoningLevel: payload.defaultReasoningLevel ?? null,
      adapterOverrides: payload.adapterOverrides ?? {},
      apiKey,
    }).pipe(Effect.catch((cause) => failMessage(describeError(cause), 400)))

    const log = yield* EffectRequestLogger
    yield* log.emit({
      event: "admin.ai_provider.litellm.updated",
      boundary: "admin.ai_provider.litellm",
      admin: {
        userId: admin.userId,
        email: admin.email,
      },
      litellm: {
        enabled: config.enabled,
        hasBaseUrl: Boolean(config.baseUrl),
        defaultModel: config.defaultModel,
        defaultReasoningLevel: config.defaultReasoningLevel,
        adapterOverrideCount: Object.keys(config.adapterOverrides).length,
        apiKeyUpdated: Boolean(apiKey),
      },
    })

    const data = yield* getAiProvidersAdminResponse(context)
    return json(data)
  },
)

export const performSyncLitellmModels = Effect.fn("admin.performSyncLitellmModels")(function* (
  context: ControlPlaneContext,
  admin: AdminIdentity,
) {
  const result = yield* runLitellmModelSync(context.env, {
    trigger: "manual",
    actorUserId: admin.userId,
    actorEmail: admin.email,
  })
  const log = yield* EffectRequestLogger
  yield* log.emit({
    event: "admin.ai_provider.litellm.synced",
    boundary: "admin.ai_provider.litellm.sync",
    admin: {
      userId: admin.userId,
      email: admin.email,
    },
    litellm: {
      status: result.status,
      models: result.models,
      registryUpdatedAt: result.registryUpdatedAt,
      runId: result.run.id,
    },
  })
  return json(result)
})

export const performExportLitellmProvider = Effect.fn("admin.performExportLitellmProvider")(
  function* (context: ControlPlaneContext, admin: AdminIdentity) {
    const result = yield* exportLitellmProviderConfig(context.env).pipe(
      Effect.catch((cause) => failMessage(describeError(cause), 500)),
    )
    const log = yield* EffectRequestLogger
    yield* log.emit({
      event: "admin.ai_provider.litellm.exported",
      boundary: "admin.ai_provider.litellm.export",
      admin: {
        userId: admin.userId,
        email: admin.email,
      },
      litellm: {
        variableCount: result.variableCount,
        includesSecret: result.includesSecret,
        includesRegistry: result.includesRegistry,
      },
    })
    return json(result)
  },
)

export const performResetLitellmProvider = Effect.fn("admin.performResetLitellmProvider")(
  function* (context: ControlPlaneContext, admin: AdminIdentity) {
    const result = yield* resetLitellmProviderConfig(context.env).pipe(
      Effect.catch((cause) => failMessage(describeError(cause), 500)),
    )
    const log = yield* EffectRequestLogger
    yield* log.emit({
      event: "admin.ai_provider.litellm.reset",
      boundary: "admin.ai_provider.litellm.reset",
      admin: {
        userId: admin.userId,
        email: admin.email,
      },
      litellm: {
        deletedKeyCount: result.deletedKeys.length,
      },
    })

    const data = yield* getAiProvidersAdminResponse(context)
    return json(data)
  },
)
