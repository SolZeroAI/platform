import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import type { ApiEnv } from "infra/types/env"
import type { SlackCreateSessionPayload } from "@c0/api"
import { resolveAgentRuntime, sessionKindForAgentRuntime } from "@c0-agent/shared"
import {
  type AuthPrincipal,
  ControlPlaneFailure,
  createSessionWithIdentity,
  failUnless,
  json,
  requirePrincipalUserId,
  resolveSlackLinkedUserId,
  resolveRequestedCustomMcpServers,
  resolveRequestedSessionTools,
  resolveUserIdentity,
  runControlPlane,
  validateRequestedAiSearchSessionTools,
  validateRequestedMcpcfSessionTools,
} from "../../shared/control-plane"
import type { GitHubProviderShape, IdentityProviderShape } from "../../../services/providers"

export interface CreatedSlackSessionResult {
  session: {
    sessionId: string
    sessionKind: SlackCreateSessionPayload["sessionKind"]
    agentRuntime: NonNullable<SlackCreateSessionPayload["agentRuntime"]>
    status: "created"
  }
  actorUserId: string
}

function invalidToolsMessage(cause: unknown): string {
  return Match.value(cause).pipe(
    Match.when(Match.instanceOf(Error), (errorValue) => errorValue.message),
    Match.orElse(() => "Invalid session tools"),
  )
}

export const createSlackSessionForPayload = Effect.fn("sessions.slack.createForPayload")(
  function* (input: {
    request: Request
    env: ApiEnv
    identityProvider: IdentityProviderShape
    githubProvider: GitHubProviderShape
    principal: AuthPrincipal | null
    payload: SlackCreateSessionPayload
  }) {
    const principalUserId = yield* requirePrincipalUserId(input.request, input.principal)

    const resolved = yield* Effect.try({
      try: () => ({
        requestedTools: resolveRequestedSessionTools(input.request, input.payload),
        requestedCustomMcpServers: resolveRequestedCustomMcpServers(input.payload),
      }),
      catch: (cause) =>
        new ControlPlaneFailure({ payload: { error: invalidToolsMessage(cause) }, status: 400 }),
    })

    const linkedUserId = yield* resolveSlackLinkedUserId(
      input.env,
      input.payload.slackUserId,
      input.identityProvider,
    )
    yield* failUnless(linkedUserId === principalUserId, "Unauthorized", 403)

    const identity = yield* resolveUserIdentity(
      input.request,
      input.env,
      input.principal,
      input.identityProvider,
    )
    yield* validateRequestedAiSearchSessionTools(input.env, resolved.requestedTools)
    yield* validateRequestedMcpcfSessionTools(input.env, resolved.requestedTools, {
      userId: identity.userId,
    })

    const agentRuntime = resolveAgentRuntime({
      agentRuntime: input.payload.agentRuntime,
      sessionKind: input.payload.sessionKind ?? "isolate",
    })
    const sessionKind = sessionKindForAgentRuntime(agentRuntime)
    const sessionId = yield* createSessionWithIdentity({
      env: input.env,
      identity,
      githubProvider: input.githubProvider,
      requestedTools: resolved.requestedTools,
      requestedCustomMcpServers: resolved.requestedCustomMcpServers,
      sessionKind,
      agentRuntime,
      source: "slack",
      serverUrl: new URL(input.request.url).origin,
      title: input.payload.title ?? null,
      model: input.payload.model,
      reasoningEffort: input.payload.reasoningEffort ?? null,
      isolateStepLimit: input.payload.isolateStepLimit ?? null,
      subagents: input.payload.subagents ?? null,
      incognito: input.payload.incognito ?? false,
      githubLogin: input.payload.githubLogin ?? null,
      githubName: input.payload.githubName ?? null,
      githubEmail: input.payload.githubEmail ?? null,
    })

    return {
      session: {
        sessionId,
        sessionKind,
        agentRuntime,
        status: "created",
      },
      actorUserId: identity.userId,
    } satisfies CreatedSlackSessionResult
  },
)

export function createSlack({ payload }: { payload: SlackCreateSessionPayload }) {
  return runControlPlane(
    Effect.fn("sessions.slack.create")(function* ({
      request,
      env,
      identityProvider,
      githubProvider,
      principal,
    }) {
      const created = yield* createSlackSessionForPayload({
        request,
        env,
        identityProvider,
        githubProvider,
        principal,
        payload,
      })

      return json(created.session, 201)
    }),
  )
}
