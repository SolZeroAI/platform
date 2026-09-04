import type { ApiEnv } from "infra/types/env"
import * as Context from "effect/Context"
import * as Match from "effect/Match"
import { D1Drizzle } from "../db/d1-drizzle"
import { ControlPlane, hasControlPlane, makeControlPlaneFromEnv } from "../db/control-plane-db"
import "../db/postgres-promise-drizzle"
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
  "s0/api/CloudflareContext",
) {}

export type CloudflareEffectContext = Context.Context<
  | CloudflareContext
  | ControlPlane
  | RequestObservability
  | EffectRequestLogger
  | IdentityProvider
  | GitHubProvider
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
  )
  return Match.value(hasControlPlane(env)).pipe(
    Match.when(true, () => Context.add(context, D1Drizzle, controlPlane.drizzle)),
    Match.orElse(() => context),
  )
}
