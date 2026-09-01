import type * as Alchemy from "alchemy"
import * as Cloudflare from "alchemy/Cloudflare"
import * as Drizzle from "alchemy/Drizzle"
import * as Layer from "effect/Layer"

export interface StackOptionsInput {
  readonly providers?: unknown
  readonly state?: unknown
}

export function stackProviders() {
  return Layer.mergeAll(Cloudflare.providers(), Drizzle.providers())
}

export function stackOptions<Req = never>(input: StackOptionsInput = {}): Alchemy.StackProps<Req> {
  return {
    providers: input.providers ?? stackProviders(),
    state: input.state ?? Cloudflare.state(),
  } as Alchemy.StackProps<Req>
}
