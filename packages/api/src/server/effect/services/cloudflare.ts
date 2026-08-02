import type { ApiEnv } from "infra/types/env"
import * as Context from "effect/Context"
import { D1Drizzle, makeD1Drizzle } from "../db/d1-drizzle"
import {
  EffectRequestLogger,
  RequestObservability,
  type RequestObservabilityService,
} from "./observability"
import { GitHubProvider, IdentityProvider, providerServicesForEnv } from "./providers"

export interface CloudflareContextShape {
  readonly env: ApiEnv
  readonly ctx: ExecutionContext
}

export class CloudflareContext extends Context.Service<CloudflareContext, CloudflareContextShape>()(
  "c0/api/CloudflareContext",
) {}

export type CloudflareEffectContext = Context.Context<
  CloudflareContext | RequestObservability | EffectRequestLogger | IdentityProvider | GitHubProvider
>

export function makeCloudflareContext(
  env: ApiEnv,
  ctx: ExecutionContext,
  observability: RequestObservabilityService,
): CloudflareEffectContext {
  const providers = providerServicesForEnv(env)
  return Context.make(CloudflareContext, { env, ctx }).pipe(
    Context.add(RequestObservability, observability),
    Context.add(EffectRequestLogger, observability.effectLog),
    Context.add(D1Drizzle, makeD1Drizzle(env.DB)),
    Context.add(IdentityProvider, providers.identityProvider),
    Context.add(GitHubProvider, providers.githubProvider),
  )
}
