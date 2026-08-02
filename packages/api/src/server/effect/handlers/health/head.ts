import * as Effect from "effect/Effect"
import { HttpServerResponse } from "effect/unstable/http"

export function head() {
  return Effect.succeed(HttpServerResponse.empty({ status: 200 }))
}
