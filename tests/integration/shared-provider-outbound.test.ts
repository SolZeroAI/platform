import * as Option from "effect/Option"
import { describe, expect, it } from "vitest"
import {
  S0_CONFIG_LITELLM_API_KEY_SECRET,
  requestWithSharedProviderCredential,
  resolveSharedProviderCredential,
  resolveSharedProviderApiKey,
  sharedProviderPathClass,
  sharedProviderRequestModel,
} from "../../packages/api/src/server/background/sandbox/providers/shared-provider-outbound"
import { CLOUDFLARE_AI_GATEWAY_RUN_TOKEN_SECRET } from "../../packages/api/src/server/background/ai-providers/cloudflare-ai-gateway"

describe("shared provider outbound helpers", () => {
  it("selects LiteLLM credentials and classifies its outbound paths", () => {
    const defaultUrl = new URL("https://litellm.example.com/v1/chat/completions")
    const anthropicUrl = new URL("https://litellm.example.com/anthropic/v1/messages")

    expect(Option.getOrThrow(resolveSharedProviderCredential({}, defaultUrl)).secretName).toBe(
      S0_CONFIG_LITELLM_API_KEY_SECRET,
    )
    expect(sharedProviderPathClass(defaultUrl)).toBe("default")
    expect(Option.getOrThrow(resolveSharedProviderCredential({}, anthropicUrl)).secretName).toBe(
      S0_CONFIG_LITELLM_API_KEY_SECRET,
    )
    expect(sharedProviderPathClass(anthropicUrl)).toBe("anthropic")
  })

  it("limits the Cloudflare credential to the account-scoped AI inference path", () => {
    const env = {
      CLOUDFLARE_ACCOUNT_ID: "account-1",
      AI_GATEWAY_ID: "gateway-1",
    }
    const inferenceUrl = new URL(
      "https://api.cloudflare.com/client/v4/accounts/account-1/ai/v1/responses",
    )
    const messagesUrl = new URL(
      "https://api.cloudflare.com/client/v4/accounts/account-1/ai/v1/messages",
    )
    const unrelatedUrl = new URL(
      "https://api.cloudflare.com/client/v4/accounts/account-1/workers/scripts",
    )

    expect(Option.getOrThrow(resolveSharedProviderCredential(env, inferenceUrl))).toEqual({
      secretName: CLOUDFLARE_AI_GATEWAY_RUN_TOKEN_SECRET,
      headers: { "cf-aig-gateway-id": "gateway-1" },
    })
    expect(Option.getOrThrow(resolveSharedProviderCredential(env, messagesUrl))).toEqual({
      secretName: CLOUDFLARE_AI_GATEWAY_RUN_TOKEN_SECRET,
      headers: { "cf-aig-gateway-id": "gateway-1" },
    })
    expect(Option.isNone(resolveSharedProviderCredential(env, unrelatedUrl))).toBe(true)
    expect(sharedProviderPathClass(inferenceUrl)).toBe("cloudflare-ai-gateway")
  })

  it("resolves canonical S0 config shared provider keys", () => {
    expect(
      Option.getOrNull(
        resolveSharedProviderApiKey(
          {
            [S0_CONFIG_LITELLM_API_KEY_SECRET]: " direct-key ",
          },
          S0_CONFIG_LITELLM_API_KEY_SECRET,
        ),
      ),
    ).toBe("direct-key")

    expect(
      Option.getOrNull(
        resolveSharedProviderApiKey(
          {
            LITELLM_API_KEY: "legacy-key",
          },
          S0_CONFIG_LITELLM_API_KEY_SECRET,
        ),
      ),
    ).toBeNull()
  })

  it("captures the requested model and injects credentials without forwarding cookies", async () => {
    const modelRequest = new Request("https://litellm.example.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "gpt-5.6-terra", input: "Hello, what model are you?" }),
    })

    expect(await sharedProviderRequestModel(modelRequest)).toBe("gpt-5.6-terra")
    const request = new Request("https://litellm.example.com/v1/responses", {
      headers: {
        authorization: "Bearer placeholder",
        cookie: "session=secret",
      },
    })
    const forwarded = requestWithSharedProviderCredential(request, "real-key", {
      "cf-aig-gateway-id": "gateway-1",
    })

    expect(forwarded.url).toBe("https://litellm.example.com/v1/responses")
    expect(forwarded.headers.get("authorization")).toBe("Bearer real-key")
    expect(forwarded.headers.get("cf-aig-gateway-id")).toBe("gateway-1")
    expect(forwarded.headers.has("cookie")).toBe(false)
  })
})
