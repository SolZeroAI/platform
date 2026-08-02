import * as Effect from "effect/Effect"
import { buildProviderSettingsResponse } from "../../../background/provider-catalog"
import {
  ControlPlaneFailure,
  describeError,
  json,
  requirePrincipalUserId,
  runControlPlane,
} from "../shared/control-plane"

export function list() {
  return runControlPlane(
    Effect.fn("providers.list")(function* ({ request, env, principal }) {
      const userId = yield* requirePrincipalUserId(request, principal)
      const response = yield* Effect.tryPromise({
        try: () => buildProviderSettingsResponse(env, userId),
        catch: (cause) =>
          new ControlPlaneFailure({ payload: { error: describeError(cause) }, status: 500 }),
      })
      return json(response)
    }),
  )
}
