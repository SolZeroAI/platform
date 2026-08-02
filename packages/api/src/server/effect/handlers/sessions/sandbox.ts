import { createSession, type CreateSessionPayload } from "./create"

export function createSandbox({ payload }: { payload: CreateSessionPayload }) {
  return createSession(payload, "sandbox")
}
