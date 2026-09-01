import type * as Alchemy from "alchemy"
import { localState, Stage } from "alchemy"
import * as Cloudflare from "alchemy/Cloudflare"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import { getAlchemyStateStoreKind } from "@solzero/shared"

export interface StackOptionsInput {
  readonly providers?: unknown
  readonly state?: unknown
}

export function stackState() {
  return Layer.unwrap(
    Effect.gen(function* () {
      const stage = yield* Stage
      return Match.value(getAlchemyStateStoreKind(stage)).pipe(
        Match.when("local", () => localState()),
        Match.when("cloudflare", () => Cloudflare.state()),
        Match.exhaustive,
      )
    }),
  )
}

export function stackOptions<Req = never>(input: StackOptionsInput = {}): Alchemy.StackProps<Req> {
  return {
    providers: input.providers ?? Cloudflare.providers(),
    state: input.state ?? stackState(),
  } as Alchemy.StackProps<Req>
}
