import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { readLatestWorkflowBuilderDraft } from "../../../mcp/workflow-builder/runtime"
import { EffectRequestLogger } from "../../services/observability"
import { failUnless, json, requireSessionAccess, runControlPlane } from "../shared/control-plane"

export function builderDraftLatest({ query }: { query: { sessionId: string } }) {
  return runControlPlane(
    Effect.fn("workflows.builderDraftLatest")(function* ({ request, env, principal }) {
      const sessionId = query.sessionId.trim()
      yield* failUnless(sessionId.length > 0, "sessionId is required", 400)
      const access = yield* requireSessionAccess(request, env, principal, sessionId)
      const draft = yield* readLatestWorkflowBuilderDraft({ env, sessionId, userId: access.userId })
      const draftSummary = Option.match(draft, {
        onNone: () => ({
          found: false,
          nodeCount: 0,
          edgeCount: 0,
          warningCount: 0,
          submittedAt: null,
        }),
        onSome: (value) => ({
          found: true,
          nodeCount: value.manifest.nodes.length,
          edgeCount: value.manifest.edges.length,
          warningCount: value.validation.warnings.length,
          submittedAt: value.submittedAt,
        }),
      })
      const log = yield* EffectRequestLogger
      yield* log.set({
        sessionId,
        ...draftSummary,
      })
      const draftPayload = Option.match(draft, {
        onSome: (value) => ({
          sessionId: value.sessionId,
          manifest: value.manifest,
          validation: value.validation,
          submittedAt: value.submittedAt,
        }),
        onNone: () => null,
      })
      return json({ draft: draftPayload })
    }),
  )
}
