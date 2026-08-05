import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import type {
  IdParams,
  PromptPayload,
  RunSessionPayload,
  SlackQueuePromptPayload,
} from "@solzero/api"
import { prompt as sessionPrompt } from "../sessions/id/prompt"
import { stop as sessionStop } from "../sessions/id/stop"
import { runSessionHttp } from "../../../application/session-run"
import {
  createSlack,
  createSlackSessionForPayload,
  type CreatedSlackSessionResult,
} from "../sessions/slack"
import { enqueuePromptForSession, json, runControlPlane } from "../shared/control-plane"

export function createSession({ payload }: { payload: SlackQueuePromptPayload["session"] }) {
  return createSlack({ payload })
}

const buildQueuePromptResponse = Effect.fn("slack.buildQueuePromptResponse")(function* (
  session: CreatedSlackSessionResult["session"],
  promptResponse: Response,
) {
  const prompt = yield* Effect.tryPromise(() => promptResponse.json())
  return json({ session, prompt })
})

export function queuePrompt({ payload }: { payload: SlackQueuePromptPayload }) {
  return runControlPlane(
    Effect.fn("slack.queuePrompt")(function* ({
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
        payload: payload.session,
      })

      const promptResponse = yield* enqueuePromptForSession({
        env,
        sessionId: created.session.sessionId,
        actorUserId: created.actorUserId,
        content: payload.prompt.content,
        source: "slack",
        model: payload.prompt.model,
        reasoningEffort: payload.prompt.reasoningEffort,
        attachments: payload.prompt.attachments,
        callbackContext: payload.prompt.callbackContext,
      })

      return yield* Match.value(promptResponse.ok).pipe(
        Match.when(false, () => Effect.succeed(promptResponse)),
        Match.orElse(() => buildQueuePromptResponse(created.session, promptResponse)),
      )
    }),
  )
}

export function prompt({ params, payload }: { params: IdParams; payload: PromptPayload }) {
  return sessionPrompt({
    params,
    payload: {
      ...payload,
      source: "slack",
    },
  })
}

export function run({ payload }: { payload: RunSessionPayload }) {
  return runSessionHttp(
    {
      ...payload,
      source: "slack",
    },
    payload.sessionKind,
  )
}

export function stop({ params }: { params: IdParams }) {
  return sessionStop({ params })
}
