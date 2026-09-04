/* oxlint-disable s0-lint/no-if-statement -- DATABASE=planetscale remote is an implementation path. deployment.providers stays Cloudflare only; this merge is Alchemy resource auth, not a cloud provider. */
import type * as Alchemy from "alchemy"
import { localState, Stage } from "alchemy"
import * as Cloudflare from "alchemy/Cloudflare"
import * as Planetscale from "alchemy/Planetscale"
import * as PlanetscaleLogicalDb from "alchemy-planetscale-logical-db"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import { getStageMetadataFromConfig } from "@solzero/shared"
import { loadS0ConfigFile, REPO_ROOT } from "./stacks/runtime"

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

export function stackState() {
  return Layer.unwrap(
    Effect.gen(function* () {
      const stage = yield* Stage
      // oxlint-disable-next-line effect/avoid-process-env -- An explicit operator-selected profile chooses a complete local deployment config without changing the Alchemy stage.
      const configProfile = process.env.S0_CONFIG_PROFILE
      const s0Config = loadS0ConfigFile(REPO_ROOT, stage, configProfile)
      const metadata = yield* getStageMetadataFromConfig(
        stage,
        s0Config.deployment,
        s0Config.application,
      ).pipe(Effect.orDie)
      return Match.value(metadata.infra.alchemyStateStore).pipe(
        Match.when("local", () => localState()),
        Match.when("cloudflare", () => Cloudflare.state()),
        Match.exhaustive,
      )
    }),
  )
}

export function stackOptions<Req = never>(input: StackOptionsInput = {}): Alchemy.StackProps<Req> {
  return {
    providers: input.providers ?? stackProviders(input),
    state: input.state ?? stackState(),
  } as Alchemy.StackProps<Req>
}
