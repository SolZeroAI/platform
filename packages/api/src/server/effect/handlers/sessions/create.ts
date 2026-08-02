import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import type { CreateSessionPayload, SessionKind } from "@c0/api"
import { resolveAgentRuntime, sessionKindForAgentRuntime } from "@c0-agent/shared"
import {
  ControlPlaneFailure,
  createSessionWithIdentity,
  describeError,
  json,
  resolveRequestedCustomMcpServers,
  resolveRequestedSessionTools,
  resolveUserIdentity,
  runControlPlane,
  validateRequestedAiSearchSessionTools,
  validateRequestedMcpcfSessionTools,
  validateRequestedSecretKeys,
} from "../shared/control-plane"

export type { CreateSessionPayload }

export function createSession(payload: CreateSessionPayload, forcedKind?: SessionKind) {
  return runControlPlane(
    Effect.fn("sessions.create")(function* ({
      request,
      env,
      principal,
      identityProvider,
      githubProvider,
    }) {
      const body = Option.match(Option.fromNullishOr(forcedKind), {
        onSome: (sessionKind) => ({ ...payload, sessionKind }),
        onNone: () => payload,
      })
      const resolved = yield* Effect.try({
        try: () => ({
          requestedTools: resolveRequestedSessionTools(request, body),
          requestedCustomMcpServers: resolveRequestedCustomMcpServers(body),
        }),
        catch: (cause) =>
          new ControlPlaneFailure({ payload: { error: describeError(cause) }, status: 400 }),
      })
      const identity = yield* resolveUserIdentity(request, env, principal, identityProvider)
      yield* validateRequestedAiSearchSessionTools(env, resolved.requestedTools)
      yield* validateRequestedMcpcfSessionTools(env, resolved.requestedTools, {
        userId: identity.userId,
      })
      const requestedSecretKeys = Array.from(new Set(body.secretKeys ?? []))
      yield* validateRequestedSecretKeys(env, requestedSecretKeys, { userId: identity.userId })

      const agentRuntime = resolveAgentRuntime({
        agentRuntime: body.agentRuntime,
        sessionKind: body.sessionKind ?? "isolate",
      })
      const sessionKind = sessionKindForAgentRuntime(agentRuntime)
      const source = Match.value(principal?.kind === "api_key").pipe(
        Match.when(true, () => "api" as const),
        Match.orElse(() => "web" as const),
      )
      const sessionId = yield* createSessionWithIdentity({
        env,
        identity,
        githubProvider,
        requestedTools: resolved.requestedTools,
        requestedCustomMcpServers: resolved.requestedCustomMcpServers,
        requestedSecretKeys,
        sessionKind,
        agentRuntime,
        source,
        serverUrl: new URL(request.url).origin,
        title: body.title ?? null,
        model: body.model,
        reasoningEffort: body.reasoningEffort ?? null,
        isolateStepLimit: body.isolateStepLimit ?? null,
        subagents: body.subagents ?? null,
        incognito: body.incognito ?? false,
        githubLogin: body.githubLogin ?? null,
        githubName: body.githubName ?? null,
        githubEmail: body.githubEmail ?? null,
      })

      return json({ sessionId, sessionKind, agentRuntime, status: "created" }, 201)
    }),
  )
}

export function create({ payload }: { payload: CreateSessionPayload }) {
  return createSession(payload)
}
