import * as Effect from "effect/Effect"
import { json, runControlPlane } from "../shared/control-plane"

export function get() {
  return runControlPlane(({ env }) =>
    Effect.succeed(
      json({
        status: "healthy",
        service: "s0-agent-control-plane",
        version: env.APP_VERSION || "v0.0.0-unknown",
        configDigest: env.S0_DEPLOYMENT_CONFIG_DIGEST,
      }),
    ),
  )
}
