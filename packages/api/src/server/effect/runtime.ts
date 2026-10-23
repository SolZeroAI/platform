import { apiForBrand } from "@solzero/api"
import { getInfraServerUrl } from "@solzero/shared"
import * as Context from "effect/Context"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import { HttpRouter, HttpServer } from "effect/http"
import { HttpApiBuilder, HttpApiScalar } from "effect/http-api"
import { stringifyJson } from "../lib/json"
import { HttpRoutesLive } from "./routes"
import { CloudflareContext } from "./services/cloudflare"
import { makeEffectLoggerLayer, observeEffectHttpApi } from "./services/observability"

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

function baseRoutes(brandName: string, serverUrl: string) {
  const api = apiForBrand(brandName, serverUrl)
  return Layer.mergeAll(
    HttpApiBuilder.layer(api, { openapiPath: "/openapi.json" }).pipe(Layer.provide(HttpRoutesLive)),
    HttpApiScalar.layer(api, { path: "/reference", scalar: scalarReferenceConfig }),
  ).pipe(
    Layer.provide(
      HttpRouter.cors({
        allowedOrigins: ["*"],
        allowedHeaders: ["Content-Type", "Authorization", "x-api-key", "x-trace-id"],
        allowedMethods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      }),
    ),
    Layer.provide(HttpServer.layerServices),
  )
}

interface EffectApiWebHandler {
  readonly dispose: () => Promise<void>
  readonly handler: (
    request: Request,
    context?: Context.Context<never>,
  ) => Promise<globalThis.Response>
}
type TelemetryLayerOptions = Parameters<typeof makeEffectLoggerLayer>[0]
type ApiHandlerOptions = TelemetryLayerOptions & {
  readonly brandName: string
  readonly serverUrl: string
}

const handlerCache = new Map<string, EffectApiWebHandler>()

const defaultTelemetryOptions: ApiHandlerOptions = {
  brandName: "SolZero",
  serverUrl: getInfraServerUrl("test"),
  stageMetadataInput: "test",
  workerName: "s0-api",
}

function telemetryStageName(input: TelemetryLayerOptions["stageMetadataInput"]): string {
  return Match.value(input).pipe(
    Match.when(Match.string, (stage) => stage),
    Match.orElse((env) => env.STAGE),
  )
}

function telemetryOptionsFromContext(context?: Context.Context<never>): ApiHandlerOptions {
  return Option.fromNullishOr(context).pipe(
    Option.filter(Context.isContext),
    Option.flatMap((ctx) => Context.getOption(ctx, CloudflareContext)),
    Option.match({
      onNone: () => defaultTelemetryOptions,
      onSome: ({ env }) => ({
        brandName: env.S0_BRAND_NAME,
        serverUrl: getInfraServerUrl(env),
        commitSha: env.COMMIT_SHA,
        stageMetadataInput: env,
        workerName: env.WORKER_NAME,
      }),
    }),
  )
}

function telemetryCacheKey(options: ApiHandlerOptions): string {
  return stringifyJson({
    commitSha: options.commitSha,
    stage: telemetryStageName(options.stageMetadataInput),
    workerName: options.workerName,
    brandName: options.brandName,
    serverUrl: options.serverUrl,
  })
}

function createWebHandler(key: string, options: ApiHandlerOptions): EffectApiWebHandler {
  const generatedHandler = HttpRouter.toWebHandler(
    baseRoutes(options.brandName, options.serverUrl).pipe(
      Layer.provide(makeEffectLoggerLayer(options)),
    ) as never,
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
