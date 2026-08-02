import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { json, requireOption, runControlPlane } from "../shared/control-plane"

export function session() {
  return runControlPlane(
    Effect.fn("auth.session")(function* ({ principal }) {
      const userPrincipal = yield* requireOption(
        Option.fromNullishOr(principal).pipe(
          Option.filter(
            (value): value is Extract<typeof value, { kind: "user_session" }> =>
              value.kind === "user_session",
          ),
        ),
        "Unauthorized",
        401,
      )
      return json(userPrincipal.sessionContext)
    }),
  )
}
