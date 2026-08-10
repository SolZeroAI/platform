import * as Effect from "effect/Effect"
import { describe, expect, it } from "vitest"
import {
  buildRuntimeProviderCatalog,
  compileOpenCodeConfigForModel,
  OPENCODE_SHARED_PROVIDER_CREDENTIAL_PROXY_API_KEY,
} from "../../packages/api/src/server/background/provider-catalog"
import type { Env } from "../../packages/api/src/server/background/types"
import { createLitellmDeploymentEnv } from "./litellm-env-fixture"
import { MemoryKVNamespace } from "./mcpcf-mcp/fixtures"
import { S0ConfigStore } from "../../packages/api/src/server/background/db/s0-config"
import {
  CLOUDFLARE_AI_GATEWAY_BYOK_PROXY_PREFIX,
  getCloudflareAiGatewayRuntimeProviderKeys,
  getCloudflareAiGatewayProviderKeyStatuses,
  updateCloudflareAiGatewayProviderKeys,
} from "../../packages/api/src/server/background/ai-providers/cloudflare-ai-gateway"

function createEnv(overrides: Partial<Env> & Record<string, unknown> = {}): Env {
  return {
    STAGE: "dev",
    S0_CONFIG: new MemoryKVNamespace() as unknown as KVNamespace,
    ...overrides,
  } as Env
}

function createCloudflareAiGatewayEnv(): Record<string, unknown> {
  return {
    S0_CONFIG_CLOUDFLARE_AI_GATEWAY: {
      enabled: true,
      cacheTtl: null,
      collectLogs: true,
      defaultModel: "openai/gpt-5.6-luna",
      models: {
        "openai/gpt-5.6-luna": {
          name: "GPT 5.6 Luna",
          provider: { npm: "@ai-sdk/openai", api: "responses" },
          reasoning: {
            efforts: ["low", "medium", "high"],
            default: "medium",
          },
        },
        "anthropic/claude-opus-5": {
          name: "Claude Opus 5",
          provider: { npm: "@ai-sdk/anthropic", api: "messages" },
          reasoning: {
            efforts: ["medium", "high", "max"],
            default: "medium",
          },
        },
      },
    },
    AI_GATEWAY: {},
    AI_GATEWAY_ID: "s0-test-ai-gateway",
    CLOUDFLARE_ACCOUNT_ID: "account-1",
    CLOUDFLARE_AI_GATEWAY_RUN_TOKEN: "gateway-run-token",
  }
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

  it("uses canonical S0_CONFIG env vars for dynamic LiteLLM models", async () => {
    const catalog = await buildRuntimeProviderCatalog(
      createEnv(createLitellmDeploymentEnv({ apiKey: "test-litellm-key" })),
      "user_1",
    )

    expect(catalog.defaultModel).toBe("litellm/gpt-5.4-mini")
    expect(
      catalog.modelOptions.flatMap((group) => group.models.map((model) => model.id)),
    ).toContain("litellm/gpt-5.4-mini")
  })

  it("exposes the native Cloudflare AI Gateway binding without an API key", async () => {
    const env = createEnv(createCloudflareAiGatewayEnv())
    const catalog = await buildRuntimeProviderCatalog(env, "user_1")

    expect(catalog.defaultModel).toBe("cloudflare-ai-gateway/openai/gpt-5.6-luna")
    expect(catalog.modelOptions[0]?.models[0]?.id).toBe("cloudflare-ai-gateway/openai/gpt-5.6-luna")
    expect(catalog.modelOptions[0]?.models[0]?.providerApi).toBe("responses")
    expect(
      catalog.modelOptions[0]?.models.find(
        (model) => model.id === "cloudflare-ai-gateway/anthropic/claude-opus-5",
      )?.providerApi,
    ).toBe("messages")
    expect(catalog.providers[0]).toMatchObject({
      providerId: "cloudflare-ai-gateway",
      hasApiKey: false,
      globalCredentialConfigured: true,
      credentialSource: "binding",
    })
  })

  it("compiles third-party models for provider-native stored BYOK execution", async () => {
    const env = createEnv(createCloudflareAiGatewayEnv())
    const model = "cloudflare-ai-gateway/openai/gpt-5.6-luna"

    const direct = await compileOpenCodeConfigForModel(env, "user_1", model, {
      sharedProviderCredentialMode: "direct",
    })
    expect(direct.config.provider["cloudflare-ai-gateway"]?.options?.apiKey).toBe(
      "s0-cloudflare-ai-gateway-stored-key",
    )
    expect(direct.config.provider["cloudflare-ai-gateway"]?.options?.baseURL).toBe(
      "https://gateway.ai.cloudflare.com/v1/account-1/s0-test-ai-gateway/openai",
    )

    const proxied = await compileOpenCodeConfigForModel(env, "user_1", model)
    expect(proxied.config.provider["cloudflare-ai-gateway"]?.options?.apiKey).toBe(
      OPENCODE_SHARED_PROVIDER_CREDENTIAL_PROXY_API_KEY,
    )
  })

  it("uses an encrypted Admin BYOK key directly in isolates and opaquely in containers", async () => {
    const kv = new MemoryKVNamespace() as unknown as KVNamespace
    const env = createEnv({
      ...createCloudflareAiGatewayEnv(),
      S0_CONFIG: kv,
      REPO_SECRETS_ENCRYPTION_KEY: "admin-key-encryption-material",
      TOKEN_ENCRYPTION_KEY: "container-key-encryption-material",
    })
    await Effect.runPromise(
      new S0ConfigStore(kv, env.REPO_SECRETS_ENCRYPTION_KEY).setEncryptedSecret(
        "secrets/ai-providers/cloudflare-ai-gateway/openai/api-key",
        "global-openai-key",
      ),
    )
    const model = "cloudflare-ai-gateway/openai/gpt-5.6-luna"

    const direct = await compileOpenCodeConfigForModel(env, "user_1", model, {
      sharedProviderCredentialMode: "direct",
    })
    expect(direct.config.provider["cloudflare-ai-gateway"]?.options?.apiKey).toBe(
      "global-openai-key",
    )

    const proxied = await compileOpenCodeConfigForModel(env, "user_1", model)
    const proxyCredential = String(
      proxied.config.provider["cloudflare-ai-gateway"]?.options?.apiKey,
    )
    expect(proxyCredential).toMatch(new RegExp(`^${CLOUDFLARE_AI_GATEWAY_BYOK_PROXY_PREFIX}`))
    expect(proxyCredential).not.toContain("global-openai-key")
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

describe("Cloudflare AI Gateway BYOK configuration", () => {
  it("stores global Admin keys encrypted and reports their source", async () => {
    const env = createEnv({
      ...createCloudflareAiGatewayEnv(),
      REPO_SECRETS_ENCRYPTION_KEY: "admin-key-encryption-material",
    })

    const statuses = await Effect.runPromise(
      updateCloudflareAiGatewayProviderKeys(env, [
        { providerId: "openai", apiKey: "global-openai-key" },
      ]),
    )

    expect(statuses.find(({ providerId }) => providerId === "openai")).toMatchObject({
      configured: true,
      source: "admin",
      locked: false,
    })
    expect(await Effect.runPromise(getCloudflareAiGatewayRuntimeProviderKeys(env))).toEqual({
      openai: "global-openai-key",
    })
  })

  it("locks Admin updates when a deployment S0 env reference owns the provider key", async () => {
    const cloudflareConfig = createCloudflareAiGatewayEnv()
      .S0_CONFIG_CLOUDFLARE_AI_GATEWAY as Record<string, unknown>
    const env = createEnv({
      ...createCloudflareAiGatewayEnv(),
      S0_CONFIG_CLOUDFLARE_AI_GATEWAY: {
        ...cloudflareConfig,
        providerKeys: {
          openai: { env: "S0_CONFIG_SECRETS_CF_AI_GATEWAY_OPENAI_API_KEY" },
        },
      },
      REPO_SECRETS_ENCRYPTION_KEY: "admin-key-encryption-material",
    })

    const statuses = await Effect.runPromise(getCloudflareAiGatewayProviderKeyStatuses(env))
    expect(statuses.find(({ providerId }) => providerId === "openai")).toMatchObject({
      configured: true,
      source: "deployment",
      locked: true,
      envVarName: "S0_CONFIG_SECRETS_CF_AI_GATEWAY_OPENAI_API_KEY",
    })

    await expect(
      Effect.runPromise(
        updateCloudflareAiGatewayProviderKeys(env, [
          { providerId: "openai", apiKey: "replacement-key" },
        ]),
      ),
    ).rejects.toMatchObject({
      _tag: "CloudflareAiGatewayProviderKeyConfigError",
      message: "OpenAI API key is managed by S0_CONFIG_SECRETS_CF_AI_GATEWAY_OPENAI_API_KEY",
    })
  })
})
