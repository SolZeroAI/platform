import type * as Alchemy from "alchemy"
import * as Cloudflare from "alchemy/Cloudflare"

export interface StackOptionsInput {
  readonly providers?: unknown
  readonly state?: unknown
}

export function stackOptions<Req = never>(input: StackOptionsInput = {}): Alchemy.StackProps<Req> {
  return {
    providers: input.providers ?? Cloudflare.providers(),
    state: input.state ?? Cloudflare.state(),
  } as Alchemy.StackProps<Req>
}
