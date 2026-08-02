import * as Effect from "effect/Effect"

export const log = (name: string, fields?: Record<string, unknown>) =>
  Effect.logInfo(name).pipe(Effect.annotateLogs(fields ?? {}))
