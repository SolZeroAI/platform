import * as Effect from "effect/Effect"
import { AiSearchRegistryStore, toAiSearchSessionSource } from "../../../background/db/ai-search"
import { json, runControlPlane } from "../shared/control-plane"

export function aiSearchSources() {
  return runControlPlane(
    Effect.fn("sessions.aiSearchSources")(function* ({ env }) {
      const sources = yield* new AiSearchRegistryStore(env).listAvailableSources()
      return json({ sources: sources.map(toAiSearchSessionSource) })
    }),
  )
}
