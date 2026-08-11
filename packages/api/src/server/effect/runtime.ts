import { S0Api } from "@solzero/api"
import * as Context from "effect/Context"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiScalar } from "effect/unstable/httpapi"
import { stringifyJson } from "../lib/json"
import { HttpRoutesLive } from "./routes"
import { CloudflareContext } from "./services/cloudflare"
import { makeEffectLoggerLayer, observeEffectHttpApi } from "./services/observability"

const ApiRoutes = HttpApiBuilder.layer(S0Api, {
  openapiPath: "/openapi.json",
}).pipe(Layer.provide(HttpRoutesLive))

type ScalarReferenceConfig = HttpApiScalar.ScalarConfig & {
  readonly persistAuth: boolean
  readonly telemetry: boolean
  readonly mcp: boolean
}

const scalarReferenceConfig = {
  theme: "saturn",
  showOperationId: true,
  persistAuth: true,
  telemetry: false,
  mcp: true,
} satisfies ScalarReferenceConfig

const DocsRoute = HttpApiScalar.layer(S0Api, {
  path: "/reference",
  scalar: scalarReferenceConfig,
})

const BaseRoutes = Layer.mergeAll(ApiRoutes, DocsRoute).pipe(
  Layer.provide(
    HttpRouter.cors({
      allowedOrigins: ["*"],
      allowedHeaders: ["Content-Type", "Authorization", "x-api-key", "x-trace-id"],
      allowedMethods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    }),
  ),
  Layer.provide(HttpServer.layerServices),
)

interface EffectApiWebHandler {
  readonly dispose: () => Promise<void>
  readonly handler: (
    request: Request,
    context?: Context.Context<never>,
  ) => Promise<globalThis.Response>
}
type TelemetryLayerOptions = Parameters<typeof makeEffectLoggerLayer>[0]

const handlerCache = new Map<string, EffectApiWebHandler>()

const defaultTelemetryOptions: TelemetryLayerOptions = {
  stageMetadataInput: "test",
  workerName: "s0-api",
}

function telemetryStageName(input: TelemetryLayerOptions["stageMetadataInput"]): string {
  return Match.value(input).pipe(
    Match.when(Match.string, (stage) => stage),
    Match.orElse((env) => env.STAGE),
  )
}

function telemetryOptionsFromContext(context?: Context.Context<never>): TelemetryLayerOptions {
  return Option.fromNullishOr(context).pipe(
    Option.filter(Context.isContext),
    Option.flatMap((ctx) => Context.getOption(ctx, CloudflareContext)),
    Option.match({
      onNone: () => defaultTelemetryOptions,
      onSome: ({ env }) => ({
        commitSha: env.COMMIT_SHA,
        stageMetadataInput: env,
        workerName: env.WORKER_NAME,
      }),
    }),
  )
}

function telemetryCacheKey(options: TelemetryLayerOptions): string {
  return stringifyJson({
    commitSha: options.commitSha,
    stage: telemetryStageName(options.stageMetadataInput),
    workerName: options.workerName,
  })
}

function createWebHandler(key: string, options: TelemetryLayerOptions): EffectApiWebHandler {
  const generatedHandler = HttpRouter.toWebHandler(
    BaseRoutes.pipe(Layer.provide(makeEffectLoggerLayer(options))) as never,
    {
      disableLogger: true,
      middleware: observeEffectHttpApi,
    },
  )
  const webHandler: EffectApiWebHandler = {
    dispose: generatedHandler.dispose,
    handler(request, context = Context.empty()) {
      return generatedHandler.handler(request, context as never)
    },
  }
  handlerCache.set(key, webHandler)
  return webHandler
}

function getWebHandler(context?: Context.Context<never>): EffectApiWebHandler {
  const options = telemetryOptionsFromContext(context)
  const key = telemetryCacheKey(options)
  return Option.getOrElse(Option.fromNullishOr(handlerCache.get(key)), () =>
    createWebHandler(key, options),
  )
}

export function handler(
  request: Request,
  context?: Context.Context<never>,
): Promise<globalThis.Response> {
  return getWebHandler(context).handler(request, context)
}

export async function dispose(): Promise<void> {
  await Promise.all([...handlerCache.values()].map((webHandler) => webHandler.dispose()))
  handlerCache.clear()
}
