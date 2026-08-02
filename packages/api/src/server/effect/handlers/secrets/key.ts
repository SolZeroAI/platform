import * as Effect from "effect/Effect"
import type { SecretKeyParams } from "@c0/api"
import {
  failUnless,
  json,
  requireGlobalSecretsStore,
  requireOption,
  requirePrincipalUserId,
  runControlPlane,
} from "../shared/control-plane"

export function deleteSecret({ params }: { params: SecretKeyParams }) {
  return runControlPlane(
    Effect.fn("secrets.delete")(function* ({ request, env, principal }) {
      const userId = yield* requirePrincipalUserId(request, principal)
      const store = yield* requireOption(
        requireGlobalSecretsStore(env),
        "REPO_SECRETS_ENCRYPTION_KEY not configured",
        500,
      )
      const deleted = yield* store.deleteSecret(params.key, { userId })
      yield* failUnless(deleted, "Secret not found", 404)
      return json({ status: "deleted", key: params.key })
    }),
  )
}
