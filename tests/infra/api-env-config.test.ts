import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { getApiInfraEnv } from "../../apps/api/infra"
import { loadC0ConfigFile } from "../../packages/infra/src/stacks/runtime"
import {
  MCPCF_PROXY_SIGNING_SECRET_MIN_LENGTH,
  c0ActiveSecretReferences,
} from "../../packages/shared/src"

const config = loadC0ConfigFile(resolve(import.meta.dirname, "../.."), "test")
const mcpcfSigningSecretEnv = config.security.mcpcfProxySigningSecret.env

function loadTestApiEnv(mcpcfProxySigningSecret?: string) {
  const secretBindings = Object.fromEntries(
    c0ActiveSecretReferences(config).flatMap((reference) =>
      reference.env === mcpcfSigningSecretEnv
        ? mcpcfProxySigningSecret === undefined
          ? []
          : [[reference.env, mcpcfProxySigningSecret] as const]
        : [[reference.env, "test-secret-value-at-least-32-characters"] as const],
    ),
  )
  return getApiInfraEnv(config, "test-config-digest", secretBindings)
}

describe("API infrastructure environment", () => {
  it("requires the MCPCF proxy signing secret", () => {
    expect(() => loadTestApiEnv()).toThrow("MCPCF_PROXY_SIGNING_SECRET")
  })

  it("rejects a short MCPCF proxy signing secret", () => {
    expect(() => loadTestApiEnv("short-secret")).toThrow(
      `at least ${MCPCF_PROXY_SIGNING_SECRET_MIN_LENGTH} characters`,
    )
  })

  it("accepts a valid MCPCF proxy signing secret", () => {
    const secret = "a".repeat(MCPCF_PROXY_SIGNING_SECRET_MIN_LENGTH)
    expect(loadTestApiEnv(secret).MCPCF_PROXY_SIGNING_SECRET).toBe(secret)
  })
})
