import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { CommonErrors, NotFoundError } from "../errors"
import { ControlPlaneAuth } from "../security"
import {
  CreatedSessionSuccess,
  IdParams,
  PromptPayload,
  PromptResponse,
  RunSessionPayload,
  RunSessionResponse,
  SlackCreateSessionPayload,
  SlackQueuedPromptResponse,
  SlackQueuePromptPayload,
  SlackSetupLinkError,
} from "../schemas/slack"
import { SessionResponse } from "../schemas/sessions"

export class SlackGroup extends HttpApiGroup.make("slack")
  .add(
    HttpApiEndpoint.post("createSession", "/sessions", {
      payload: SlackCreateSessionPayload,
      success: CreatedSessionSuccess,
      error: [SlackSetupLinkError, ...CommonErrors],
    })
      .middleware(ControlPlaneAuth)
      .annotateMerge(OpenApi.annotations({ summary: "Create Slack session" })),
    HttpApiEndpoint.post("queuePrompt", "/sessions/queue", {
      payload: SlackQueuePromptPayload,
      success: SlackQueuedPromptResponse,
      error: [SlackSetupLinkError, ...CommonErrors],
    })
      .middleware(ControlPlaneAuth)
      .annotateMerge(OpenApi.annotations({ summary: "Create Slack session and queue prompt" })),
    HttpApiEndpoint.post("run", "/sessions/run", {
      payload: RunSessionPayload,
      success: RunSessionResponse,
      error: CommonErrors,
    })
      .middleware(ControlPlaneAuth)
      .annotateMerge(OpenApi.annotations({ summary: "Run Slack-sourced session prompt" })),
    HttpApiEndpoint.post("prompt", "/sessions/:id/prompt", {
      params: IdParams,
      payload: PromptPayload,
      success: PromptResponse,
      error: [NotFoundError, ...CommonErrors],
    })
      .middleware(ControlPlaneAuth)
      .annotateMerge(OpenApi.annotations({ summary: "Queue Slack-sourced prompt" })),
    HttpApiEndpoint.post("stop", "/sessions/:id/stop", {
      params: IdParams,
      success: SessionResponse,
      error: [NotFoundError, ...CommonErrors],
    })
      .middleware(ControlPlaneAuth)
      .annotateMerge(OpenApi.annotations({ summary: "Stop Slack session" })),
  )
  .prefix("/slack") {}
