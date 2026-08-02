import * as Match from "effect/Match"
import * as Option from "effect/Option"
import type { ApiRequestObserver } from "../../../effect/services/observability"
import type { IsolateModelContext } from "../model"
import { getStreamRequestId, type IsolatePromptRequest } from "./types"

interface StreamLifecycleHost {
  readonly state: { userId: string }
  getRuntimeId(): string
  createInternalRequestObserver(path: string, routeBranch: string): ApiRequestObserver
}

export function logIsolateStreamLifecycle(
  host: StreamLifecycleHost,
  status: "started" | "interrupted",
  input: {
    request: IsolatePromptRequest
    model: IsolateModelContext
    requestId: string | Option.Option<string>
  },
): void {
  const observer = host.createInternalRequestObserver(
    `stream_${status}`,
    "isolate-stream-lifecycle",
  )
  const fields = {
    sessionId: host.getRuntimeId(),
    userId: host.state.userId,
    requestId: getStreamRequestId(input.requestId),
    runtimeModelId: input.model.runtimeModelId,
    modelId: input.model.modelId,
    providerId: input.model.providerId,
    messageContentLength: input.request.content.length,
    reasoningEffort: input.request.reasoningEffort ?? "",
  }
  Match.value(status).pipe(
    Match.when("interrupted", () => observer.log.warn("Isolate stream interrupted", fields)),
    Match.orElse(() => observer.log.info("Isolate stream started", fields)),
  )
}
