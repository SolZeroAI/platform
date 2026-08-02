import * as Effect from "effect/Effect"
import {
  json,
  requireGlobalSecretsStore,
  requireOption,
  requirePrincipalUserId,
  runControlPlane,
} from "../shared/control-plane"

export function listTags() {
  return runControlPlane(
    Effect.fn("secrets.listTags")(function* ({ request, env, principal }) {
      const userId = yield* requirePrincipalUserId(request, principal)
      const store = yield* requireOption(
        requireGlobalSecretsStore(env),
        "REPO_SECRETS_ENCRYPTION_KEY not configured",
        500,
      )
      const result = yield* store.listSecretTagStats({ userId })
      return json(result)
    }),
  )
}
