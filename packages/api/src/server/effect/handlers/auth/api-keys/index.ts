import * as Effect from "effect/Effect"
import type { CreateApiKeyPayload } from "@c0/api"
import { UserApiKeyStore } from "../../../../background/db/user-api-keys"
import {
  json,
  requireOption,
  resolvePrincipalUserId,
  runControlPlane,
} from "../../shared/control-plane"

export function createApiKey({ payload }: { payload: CreateApiKeyPayload }) {
  return runControlPlane(
    Effect.fn("auth.apiKeys.create")(function* ({ request, env, principal }) {
      const userId = yield* requireOption(
        resolvePrincipalUserId(request, principal),
        "Missing acting user context",
        401,
      )
      const store = new UserApiKeyStore(env.DB)
      const created = yield* store.create(userId, payload.label ?? null)
      return json(created, 201)
    }),
  )
}

export function listApiKeys() {
  return runControlPlane(
    Effect.fn("auth.apiKeys.list")(function* ({ request, env, principal }) {
      const userId = yield* requireOption(
        resolvePrincipalUserId(request, principal),
        "Missing acting user context",
        401,
      )
      const store = new UserApiKeyStore(env.DB)
      const keys = yield* store.listByUserId(userId)
      return json({ keys })
    }),
  )
}
