import { Context } from "effect"
import { HttpApiMiddleware, HttpApiSecurity } from "effect/unstable/httpapi"
import { InternalServerError, UnauthorizedError } from "./errors"

export interface UserSessionContext {
  readonly user: {
    readonly id: string
    readonly name: string
    readonly email: string
    readonly image: string | null
  }
  readonly githubAccountId: string | null
  readonly isAdmin: boolean
}

export interface UserSessionPrincipal {
  readonly kind: "user_session"
  readonly userId: string
  readonly sessionContext: UserSessionContext
}

export interface ApiKeyPrincipal {
  readonly kind: "api_key"
  readonly keyId: string
  readonly userId: string
}

export type AuthPrincipal = UserSessionPrincipal | ApiKeyPrincipal

export class CurrentPrincipal extends Context.Service<CurrentPrincipal, AuthPrincipal>()(
  "s0/api/CurrentPrincipal",
) {}

const AuthFailure = [UnauthorizedError, InternalServerError] as const

export class ControlPlaneAuth extends HttpApiMiddleware.Service<
  ControlPlaneAuth,
  {
    readonly provides: CurrentPrincipal
  }
>()("s0/api/ControlPlaneAuth", {
  error: AuthFailure,
  security: {
    bearerAuth: HttpApiSecurity.bearer,
    apiKey: HttpApiSecurity.apiKey({
      in: "header",
      key: "x-api-key",
    }),
  },
}) {}
