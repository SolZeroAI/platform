import { Schema } from "effect"
import {
  CreatedSessionResponse,
  CreatedSessionSuccess,
  IdParams,
  PromptPayload,
  PromptResponse,
  RunSessionPayload,
  RunSessionResponse,
  SlackCreateSessionPayload,
  SlackSetupLinkError,
} from "./sessions"

export { IdParams, PromptPayload, RunSessionPayload, SlackCreateSessionPayload }

export const SlackQueuePromptPayload = Schema.Struct({
  session: SlackCreateSessionPayload,
  prompt: PromptPayload,
})
export type SlackQueuePromptPayload = typeof SlackQueuePromptPayload.Type

export class SlackQueuedPromptResponse extends Schema.Class<SlackQueuedPromptResponse>(
  "SlackQueuedPromptResponse",
)({
  session: CreatedSessionResponse,
  prompt: PromptResponse,
}) {}

export { CreatedSessionSuccess, PromptResponse, RunSessionResponse, SlackSetupLinkError }
