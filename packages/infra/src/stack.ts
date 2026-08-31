/* oxlint-disable s0-lint/no-if-statement -- DATABASE=planetscale remote is an implementation path. deployment.providers stays Cloudflare only; this merge is Alchemy resource auth, not a cloud provider. */
import type * as Alchemy from "alchemy"
import * as Cloudflare from "alchemy/Cloudflare"
import * as Planetscale from "alchemy/Planetscale"
import * as PlanetscaleLogicalDb from "alchemy-planetscale-logical-db"
import * as Layer from "effect/Layer"

export interface StackOptionsInput {
  readonly providers?: unknown
  readonly state?: unknown
  readonly planetscale?: boolean
  readonly postgresLogicalDatabase?: boolean
}

export function stackProviders(input: StackOptionsInput = {}) {
  if (input.planetscale || input.postgresLogicalDatabase) {
    return Layer.mergeAll(
      Cloudflare.providers(),
      Planetscale.providers(),
      PlanetscaleLogicalDb.providers(),
    )
  }
  return Cloudflare.providers()
}

export function stackOptions<Req = never>(input: StackOptionsInput = {}): Alchemy.StackProps<Req> {
  return {
    providers: input.providers ?? stackProviders(input),
    state: input.state ?? Cloudflare.state(),
  } as Alchemy.StackProps<Req>
}
