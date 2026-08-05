import * as Effect from "effect/Effect"
import type { ProviderSettingsPayload } from "@solzero/api"
import {
  buildProviderSettingsResponse,
  parseProviderSettingsUpdate,
  replaceUserProviderSettings,
} from "../../../background/provider-catalog"
import {
  ControlPlaneFailure,
  describeError,
  json,
  requirePrincipalUserId,
  runControlPlane,
} from "../shared/control-plane"

export function replace({ payload }: { payload: ProviderSettingsPayload }) {
  return runControlPlane(
    Effect.fn("providers.replace")(function* ({ request, env, principal }) {
      const userId = yield* requirePrincipalUserId(request, principal)
      yield* Effect.tryPromise({
        try: async () => {
          const parsed = parseProviderSettingsUpdate(payload)
          await replaceUserProviderSettings(env, userId, parsed)
        },
        catch: (cause) =>
          new ControlPlaneFailure({ payload: { error: describeError(cause) }, status: 400 }),
      })
      const response = yield* Effect.tryPromise({
        try: () => buildProviderSettingsResponse(env, userId),
        catch: (cause) =>
          new ControlPlaneFailure({ payload: { error: describeError(cause) }, status: 500 }),
      })
      return json(response)
    }),
  )
}
