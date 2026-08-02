import { describe, expect, it } from "vitest"
import { buildRuntimeProviderCatalog } from "../../packages/api/src/server/background/provider-catalog"
import type { Env } from "../../packages/api/src/server/background/types"
import { createLitellmDeploymentEnv } from "./litellm-env-fixture"
import { MemoryKVNamespace } from "./mcpcf-mcp/fixtures"

function createEnv(overrides: Partial<Env> & Record<string, unknown> = {}): Env {
  return {
    STAGE: "dev",
    C0_CONFIG: new MemoryKVNamespace() as unknown as KVNamespace,
    ...overrides,
  } as Env
}

describe("runtime provider catalog", () => {
  it("does not expose static LiteLLM defaults without an env or admin provider key", async () => {
    const catalog = await buildRuntimeProviderCatalog(createEnv(), "user_1")

    expect(catalog.defaultModel).toBeNull()
    expect(catalog.modelOptions).toEqual([])
  })

  it("ignores legacy direct LiteLLM API key env vars", async () => {
    const catalog = await buildRuntimeProviderCatalog(
      createEnv({
        LITELLM_API_KEY: "test-litellm-key",
      }),
      "user_1",
    )

    expect(catalog.defaultModel).toBeNull()
    expect(catalog.modelOptions).toEqual([])
  })

  it("uses canonical C0_CONFIG env vars for dynamic LiteLLM models", async () => {
    const catalog = await buildRuntimeProviderCatalog(
      createEnv(createLitellmDeploymentEnv({ apiKey: "test-litellm-key" })),
      "user_1",
    )

    expect(catalog.defaultModel).toBe("litellm/gpt-5.4-mini")
    expect(
      catalog.modelOptions.flatMap((group) => group.models.map((model) => model.id)),
    ).toContain("litellm/gpt-5.4-mini")
  })

  it("does not invent a default model when providers are configured without one", async () => {
    const catalog = await buildRuntimeProviderCatalog(
      createEnv(createLitellmDeploymentEnv({ apiKey: "test-litellm-key", defaultModel: null })),
      "user_1",
    )

    expect(catalog.defaultModel).toBeNull()
    expect(
      catalog.modelOptions.flatMap((group) => group.models.map((model) => model.id)),
    ).toContain("litellm/gpt-5.4-mini")
  })
})
