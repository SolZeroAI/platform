import * as Alchemy from "alchemy"
import * as Cloudflare from "@alchemy.run/cloudflare"
import * as Effect from "effect/Effect"

export default Alchemy.Stack(
  "StateInspect",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.succeed({}),
)
