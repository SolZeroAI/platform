import * as Option from "effect/Option"
import { describe, expect, it } from "vitest"
import {
  C0_CONFIG_LITELLM_API_KEY_SECRET,
  requestWithSharedProviderCredential,
  resolveSharedProviderApiKey,
  sharedProviderPathClass,
  sharedProviderRequestModel,
  sharedProviderSecretName,
} from "../../packages/api/src/server/background/sandbox/providers/shared-provider-outbound"

describe("shared provider outbound helpers", () => {
  it("selects LiteLLM credentials by outbound path", () => {
    const defaultUrl = new URL("https://litellm.example.com/v1/chat/completions")
    const anthropicUrl = new URL("https://litellm.example.com/anthropic/v1/messages")

    expect(sharedProviderSecretName(defaultUrl)).toBe(C0_CONFIG_LITELLM_API_KEY_SECRET)
    expect(sharedProviderPathClass(defaultUrl)).toBe("default")
    expect(sharedProviderSecretName(anthropicUrl)).toBe(C0_CONFIG_LITELLM_API_KEY_SECRET)
    expect(sharedProviderPathClass(anthropicUrl)).toBe("anthropic")
  })

  it("resolves canonical C0 config shared provider keys", () => {
    expect(
      Option.getOrNull(
        resolveSharedProviderApiKey(
          {
            [C0_CONFIG_LITELLM_API_KEY_SECRET]: " direct-key ",
          },
          C0_CONFIG_LITELLM_API_KEY_SECRET,
        ),
      ),
    ).toBe("direct-key")

    expect(
      Option.getOrNull(
        resolveSharedProviderApiKey(
          {
            LITELLM_API_KEY: "legacy-key",
          },
          C0_CONFIG_LITELLM_API_KEY_SECRET,
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
    const forwarded = requestWithSharedProviderCredential(request, "real-key")

    expect(forwarded.url).toBe("https://litellm.example.com/v1/responses")
    expect(forwarded.headers.get("authorization")).toBe("Bearer real-key")
    expect(forwarded.headers.has("cookie")).toBe(false)
  })
})
