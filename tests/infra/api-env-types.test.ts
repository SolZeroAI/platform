import type * as Cloudflare from "alchemy/Cloudflare"
import type { Json } from "effect/Schema"
import { describe, expectTypeOf, it } from "vitest"
import type { ApiWorkerBindingResources } from "../../apps/api/infra"
import type { ApiEnv } from "../../packages/infra/src/types/env"

type InferredApiEnv = Cloudflare.InferEnv<ApiWorkerBindingResources>

describe("API env types", () => {
  it("derive directly from the Alchemy API worker binding resources", () => {
    expectTypeOf<ApiEnv>().toEqualTypeOf<InferredApiEnv>()
    expectTypeOf<ApiEnv["AI_SEARCH"]>().toEqualTypeOf<AiSearchNamespace>()
    expectTypeOf<ApiEnv["WORKFLOW_AI_SEARCH"]>().toEqualTypeOf<AiSearchNamespace>()
    expectTypeOf<ApiEnv["AI_SEARCH_CONTENT_BUCKET"]>().toEqualTypeOf<R2Bucket>()
    expectTypeOf<ApiEnv["AI_GATEWAY"]>().toEqualTypeOf<Ai | undefined>()
    expectTypeOf<ApiEnv["AI_GATEWAY_ID"]>().toEqualTypeOf<string | undefined>()
    expectTypeOf<ApiEnv["CLOUDFLARE_AI_GATEWAY_RUN_TOKEN"]>().toEqualTypeOf<string | undefined>()
    expectTypeOf<ApiEnv["S0_CONFIG_AUTH"]>().toEqualTypeOf<Json>()
    expectTypeOf<ApiEnv["S0_CONFIG_CLOUDFLARE_AI_GATEWAY"]>().toEqualTypeOf<Json>()
    expectTypeOf<ApiEnv["S0_STAGE_METADATA"]>().toEqualTypeOf<Json>()
    expectTypeOf<ApiEnv["S0_DEPLOYMENT_CONFIG_DIGEST"]>().toEqualTypeOf<string>()
    expectTypeOf<ApiEnv["DATABASE"]>().toEqualTypeOf<string>()
    expectTypeOf<ApiEnv["S0_CONFIG_SECRETS_AUTH_ADMIN_PASSWORD"]>().toEqualTypeOf<string>()
    expectTypeOf<ApiEnv["AUTH_SIGN_IN_RATE_LIMIT"]>().toEqualTypeOf<RateLimit>()
    expectTypeOf<ApiEnv["DYNAMIC_WORKFLOW"]>().toEqualTypeOf<Workflow>()
    expectTypeOf<ApiEnv["OPENCODE_AGENT"]>().toMatchTypeOf<DurableObjectNamespace>()
    expectTypeOf<ApiEnv["CODEX_AGENT"]>().toMatchTypeOf<DurableObjectNamespace>()
    expectTypeOf<ApiEnv["CLAUDE_CODE_AGENT"]>().toMatchTypeOf<DurableObjectNamespace>()
    expectTypeOf<ApiEnv["ISOLATE_SESSION"]>().toMatchTypeOf<DurableObjectNamespace>()
    expectTypeOf<ApiEnv["WORKFLOW_ACTIONS"]>().toMatchTypeOf<Fetcher>()
    expectTypeOf<ApiEnv>().not.toHaveProperty("ISOLATE_SUB_AGENT")
    expectTypeOf<ApiEnv>().not.toHaveProperty("ISOLATE_SUBAGENT")
    expectTypeOf<ApiEnv>().not.toHaveProperty("SELF")
    expectTypeOf<ApiEnv>().not.toHaveProperty("SANDBOX")
    expectTypeOf<ApiEnv>().not.toHaveProperty("CLOUDFLARE_API_TOKEN")
  })
})
