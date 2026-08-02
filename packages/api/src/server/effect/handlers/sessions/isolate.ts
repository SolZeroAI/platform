import { createSession, type CreateSessionPayload } from "./create"

export function createIsolate({ payload }: { payload: CreateSessionPayload }) {
  return createSession(payload, "isolate")
}
