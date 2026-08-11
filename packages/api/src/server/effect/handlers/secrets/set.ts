import * as Effect from "effect/Effect"
import type { SecretsPayload } from "@solzero/api"
import {
  json,
  requireGlobalSecretsStore,
  requireOption,
  requirePrincipalUserId,
  runControlPlane,
} from "../shared/control-plane"

export function set({ payload }: { payload: SecretsPayload }) {
  return runControlPlane(
    Effect.fn("secrets.set")(function* ({ request, env, principal }) {
      const userId = yield* requirePrincipalUserId(request, principal)
      const store = yield* requireOption(
        requireGlobalSecretsStore(env),
        "REPO_SECRETS_ENCRYPTION_KEY not configured",
        500,
      )
      const result = yield* store.setSecrets(payload.secrets, { userId })
      return json({
        status: "updated",
        keys: result.keys,
        created: result.created,
        updated: result.updated,
      })
    }),
  )
}
