import * as Effect from "effect/Effect"
import type { KeyIdParams } from "@solzero/api"
import { UserApiKeyStore } from "../../../../background/db/user-api-keys"
import {
  failUnless,
  json,
  requireOption,
  resolvePrincipalUserId,
  runControlPlane,
} from "../../shared/control-plane"

export function deleteApiKey({ params }: { params: KeyIdParams }) {
  return runControlPlane(
    Effect.fn("auth.apiKeys.delete")(function* ({ request, env, principal }) {
      const userId = yield* requireOption(
        resolvePrincipalUserId(request, principal),
        "Missing acting user context",
        401,
      )
      const store = new UserApiKeyStore(env.DB)
      const deleted = yield* store.revoke(userId, params.keyId)
      yield* failUnless(deleted, "API key not found", 404)
      return json({ status: "deleted", keyId: params.keyId })
    }),
  )
}
