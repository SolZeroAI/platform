import type { ApiEnv } from "infra/types/env"
import {
  applyStoredSessionToolAvailability,
  getSelectedAiSearchSourceIds,
  getSelectedMcpcfServerIds,
  getSessionToolId,
  type SessionToolAvailability,
  type SessionToolSpec,
  type StoredSessionToolResolution,
} from "@c0-agent/shared"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import { AiSearchRegistryStore } from "../../../../background/db/ai-search"
import { McpcfRegistryStore } from "../../../../background/db/mcpcf"
import { describeError } from "../../../../lib/effect-errors"

const resolveAiSearchToolAvailability = Effect.fn("controlPlane.resolveAiSearchToolAvailability")(
  function* (env: ApiEnv, tools: readonly SessionToolSpec[]) {
    const sourceIds = getSelectedAiSearchSourceIds(tools)
    const sources = yield* new AiSearchRegistryStore(env).listSources()
    const sourcesById = new Map(sources.map((source) => [source.id, source]))

    return sourceIds.flatMap((toolId) =>
      Option.match(Option.fromNullishOr(sourcesById.get(toolId)), {
        onNone: (): SessionToolAvailability[] => [
          { kind: "ai_search", toolId, reason: "missing_resource" },
        ],
        onSome: (source) =>
          Match.value(source.enabled).pipe(
            Match.when(true, () => []),
            Match.orElse((): SessionToolAvailability[] => [
              { kind: "ai_search", toolId, reason: "disabled" },
            ]),
          ),
      }),
    )
  },
)

const resolveMcpcfToolAvailability = Effect.fn("controlPlane.resolveMcpcfToolAvailability")(
  function* (env: ApiEnv, tools: readonly SessionToolSpec[]) {
    const serverIds = getSelectedMcpcfServerIds(tools)
    const servers = yield* new McpcfRegistryStore(env).listServersByIds(serverIds)
    const serversById = new Map(servers.map((server) => [server.id, server]))

    return serverIds.flatMap((toolId) =>
      Option.match(Option.fromNullishOr(serversById.get(toolId)), {
        onNone: (): SessionToolAvailability[] => [
          { kind: "mcpcf_server", toolId, reason: "missing_resource" },
        ],
        onSome: (server) =>
          Match.value(server.enabled && server.sourceStatus === "active").pipe(
            Match.when(true, () => []),
            Match.orElse((): SessionToolAvailability[] => [
              { kind: "mcpcf_server", toolId, reason: "disabled" },
            ]),
          ),
      }),
    )
  },
)

const SESSION_TOOL_AVAILABILITY_REGISTRY = [
  {
    kind: "ai_search",
    resolve: resolveAiSearchToolAvailability,
  },
  {
    kind: "mcpcf_server",
    resolve: resolveMcpcfToolAvailability,
  },
] as const

type SessionToolAvailabilityDefinition = (typeof SESSION_TOOL_AVAILABILITY_REGISTRY)[number]

const resolveToolKindAvailability = Effect.fn("controlPlane.resolveToolKindAvailability")(
  function* (
    env: ApiEnv,
    tools: readonly SessionToolSpec[],
    definition: SessionToolAvailabilityDefinition,
  ) {
    const selectedTools = tools.filter((tool) => tool.kind === definition.kind)
    const availability = definition.resolve(env, selectedTools).pipe(
      Effect.catch((errorValue) =>
        Effect.logWarning("session_tools.availability_lookup_failed").pipe(
          Effect.annotateLogs({
            toolKind: definition.kind,
            toolCount: selectedTools.length,
            error: describeError(errorValue),
          }),
          Effect.map(() =>
            selectedTools.map(
              (tool): SessionToolAvailability => ({
                kind: tool.kind,
                toolId: getSessionToolId(tool),
                reason: "availability_unknown",
              }),
            ),
          ),
        ),
      ),
    )
    const hasSelectedTools = Effect.succeed(selectedTools.length > 0)
    return yield* Effect.when(availability, hasSelectedTools).pipe(
      Effect.map(Option.getOrElse((): SessionToolAvailability[] => [])),
    )
  },
)

export const resolveSessionListToolAvailability = Effect.fn(
  "controlPlane.resolveSessionListToolAvailability",
)(function* (env: ApiEnv, resolutions: readonly StoredSessionToolResolution[]) {
  const tools = resolutions.flatMap((resolution) => resolution.tools)
  const unavailableByKind = yield* Effect.forEach(
    SESSION_TOOL_AVAILABILITY_REGISTRY,
    (definition) => resolveToolKindAvailability(env, tools, definition),
    { concurrency: "unbounded" },
  )
  const availability = unavailableByKind.flat()
  return resolutions.map((resolution) =>
    applyStoredSessionToolAvailability(resolution, availability),
  )
})
