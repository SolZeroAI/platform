import type { ApiEnv } from "infra/types/env"
import * as Context from "effect/Context"
import * as Match from "effect/Match"
import { D1Drizzle } from "../db/d1-drizzle"
// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- cloudflare.ts builds makeControlPlaneFromEnv from the Worker env at the composition edge because CloudflareContext layers the control plane beside the request services.
import { ControlPlane, hasControlPlane, makeControlPlaneFromEnv } from "../db/control-plane-db"
import "../db/postgres-promise-drizzle"
import {
  EffectRequestLogger,
  RequestObservability,
  type RequestObservabilityService,
} from "./observability"
import { AiGatewayBinding } from "./ai-gateway-binding"
import { GitHubProvider, IdentityProvider, providerServicesForEnv } from "./providers"

export interface CloudflareContextService {
  readonly env: ApiEnv
  readonly ctx: ExecutionContext
}

export class CloudflareContext extends Context.Service<
  CloudflareContext,
  CloudflareContextService
>()("s0/api/CloudflareContext") {}

export type CloudflareEffectContext = Context.Context<
  | CloudflareContext
  | ControlPlane
  | RequestObservability
  | EffectRequestLogger
  | IdentityProvider
  | GitHubProvider
  | AiGatewayBinding
>

export function makeCloudflareContext(
  env: ApiEnv,
  ctx: ExecutionContext,
  observability: RequestObservabilityService,
): CloudflareEffectContext {
  const providers = providerServicesForEnv(env)
  const controlPlane = makeControlPlaneFromEnv(env)

  const context = Context.make(CloudflareContext, { env, ctx }).pipe(
    Context.add(RequestObservability, observability),
    Context.add(EffectRequestLogger, observability.effectLog),
    Context.add(ControlPlane, controlPlane),
    Context.add(IdentityProvider, providers.identityProvider),
    Context.add(GitHubProvider, providers.githubProvider),
    Context.add(AiGatewayBinding, providers.aiGateway),
  )

  return Match.value(hasControlPlane(env)).pipe(
    Match.when(true, () => Context.add(context, D1Drizzle, controlPlane.drizzle)),
    Match.orElse(() => context),
  )
}
