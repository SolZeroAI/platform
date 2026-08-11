import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { getApiInfraEnv } from "../../apps/api/infra"
import { loadS0ConfigFile } from "../../packages/infra/src/stacks/runtime"
import {
  MCPCF_PROXY_SIGNING_SECRET_MIN_LENGTH,
  s0ActiveSecretReferences,
} from "../../packages/shared/src"

const config = loadS0ConfigFile(resolve(import.meta.dirname, "../.."), "test")
const mcpcfSigningSecretEnv = config.security.mcpcfProxySigningSecret.env

function loadTestApiEnv(mcpcfProxySigningSecret?: string) {
  const secretBindings = Object.fromEntries(
    s0ActiveSecretReferences(config).flatMap((reference) =>
      reference.env === mcpcfSigningSecretEnv
        ? mcpcfProxySigningSecret === undefined
          ? []
          : [[reference.env, mcpcfProxySigningSecret] as const]
        : [[reference.env, "test-secret-value-at-least-32-characters"] as const],
    ),
  )
  return getApiInfraEnv(config, "config/test.config.jsonc", "test-config-digest", secretBindings)
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
    const env = loadTestApiEnv(secret)

    expect(env.MCPCF_PROXY_SIGNING_SECRET).toBe(secret)
    expect(env.S0_CONFIG_FILE).toBe("config/test.config.jsonc")
    expect(env.S0_CONFIG_CLOUDFLARE_AI_GATEWAY).toEqual(config.aiProviders.cloudflareAiGateway)
  })
})
