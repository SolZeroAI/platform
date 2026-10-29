import * as Effect from "effect/Effect"
import * as Option from "effect/Option"

// Promise boundary for the non-Effect background runtime (Durable Objects, workflow nodes, routers,
// and MCP servers). Stores expose Promise-facing views through these helpers, so the run call stays
// in one module.

export function runEffectPromise<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect)
}

export function runOptionPromise<A, E>(
  effect: Effect.Effect<Option.Option<A>, E>,
): Promise<A | null> {
  return Effect.runPromise(effect.pipe(Effect.map(Option.getOrNull)))
}
