import {
  buildSessionToolRuntimePlan,
  normalizeOpenCodeMcpServers,
  normalizeSessionTools,
  type OpenCodeMcpServers,
  type StageMetadataInput,
  type SessionToolSpec,
} from "@solzero/shared"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { issueMcpcfProxyCapability } from "../auth/mcpcf-capability"
import { McpcfRegistryStore } from "../db/mcpcf"
import { toError } from "../../lib/effect-errors"
import type { Env } from "../types"
import { buildSessionMcpServersFromPlan } from "./mcp-config"

export const resolveSelectedMcpcfServers = Effect.fn("session.resolveSelectedMcpcfServers")(
  function* (input: { env: Env; tools: readonly SessionToolSpec[] | null | undefined }) {
    const tools = normalizeSessionTools(input.tools)
    const registry = new McpcfRegistryStore(input.env)
    return yield* registry.listSelectedAvailableServers(tools)
  },
)

export const buildResolvedSessionMcpServers = Effect.fn("session.buildResolvedMcpServers")(
  function* (input: {
    env: Env
    tools: readonly SessionToolSpec[] | null | undefined
    customMcpServers?: OpenCodeMcpServers | null
    sessionId?: string | null
    stage?: StageMetadataInput | null
  }) {
    const plan = yield* buildResolvedSessionToolRuntimePlan(input)
    const needsMcpcfCapability = plan.sandboxMcp.mcpcfServers.length > 0
    const missingSessionId = Effect.fail(toError("MCPCF session id is required"))
    const missingSessionIdGuard = Effect.succeed(needsMcpcfCapability && !input.sessionId)
    yield* Effect.when(missingSessionId, missingSessionIdGuard)
    const issueCapability = Effect.tryPromise({
      try: () =>
        issueMcpcfProxyCapability(input.env.MCPCF_PROXY_SIGNING_SECRET, input.sessionId ?? ""),
      catch: toError,
    })
    const capabilityGuard = Effect.succeed(needsMcpcfCapability)
    const mcpcfCapability = yield* Effect.when(issueCapability, capabilityGuard)

    return buildSessionMcpServersFromPlan({
      plan,
      sessionId: input.sessionId,
      mcpcfCapability: Option.getOrNull(mcpcfCapability),
      stage: input.stage,
    })
  },
)

export const buildResolvedSessionToolRuntimePlan = Effect.fn(
  "session.buildResolvedToolRuntimePlan",
)(function* (input: {
  env: Env
  tools: readonly SessionToolSpec[] | null | undefined
  customMcpServers?: OpenCodeMcpServers | null
}) {
  const tools = normalizeSessionTools(input.tools)
  const customMcpServers = normalizeOpenCodeMcpServers(input.customMcpServers)
  const mcpcfServers = yield* resolveSelectedMcpcfServers({ env: input.env, tools })

  return buildSessionToolRuntimePlan({
    tools,
    customMcpServers,
    mcpcfServers,
  })
})
