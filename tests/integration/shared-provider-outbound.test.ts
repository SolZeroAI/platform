import * as Option from "effect/Option"
import { describe, expect, it } from "vitest"
import {
  requestWithCloudflareProviderNativeCredential,
  S0_CONFIG_LITELLM_API_KEY_SECRET,
  requestWithSharedProviderCredential,
  resolveSharedProviderCredential,
  resolveSharedProviderApiKey,
  sharedProviderPathClass,
  sharedProviderRequestModel,
} from "../../packages/api/src/server/background/sandbox/providers/shared-provider-outbound"
import {
  CLOUDFLARE_AI_GATEWAY_RUN_TOKEN_SECRET,
  normalizeCloudflareAiGatewayResponse,
} from "../../packages/api/src/server/background/ai-providers/cloudflare-ai-gateway"
import {
  CLOUDFLARE_AI_GATEWAY_TOP_UP_URL,
  CLOUDFLARE_AI_GATEWAY_UNIFIED_BILLING_DOCS_URL,
  CLOUDFLARE_WORKERS_AI_PRICING_DOCS_URL,
} from "../../packages/shared/src"

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
      kind: "cloudflare-rest",
      secretName: CLOUDFLARE_AI_GATEWAY_RUN_TOKEN_SECRET,
      headers: { "cf-aig-gateway-id": "gateway-1" },
    })
    expect(Option.getOrThrow(resolveSharedProviderCredential(env, messagesUrl))).toEqual({
      kind: "cloudflare-rest",
      secretName: CLOUDFLARE_AI_GATEWAY_RUN_TOKEN_SECRET,
      headers: { "cf-aig-gateway-id": "gateway-1" },
    })
    expect(Option.isNone(resolveSharedProviderCredential(env, unrelatedUrl))).toBe(true)
    expect(sharedProviderPathClass(inferenceUrl)).toBe("cloudflare-ai-gateway")
  })

  it("routes provider-native Gateway requests with separate gateway and provider credentials", () => {
    const env = {
      CLOUDFLARE_ACCOUNT_ID: "account-1",
      AI_GATEWAY_ID: "gateway-1",
    }
    const url = new URL(
      "https://gateway.ai.cloudflare.com/v1/account-1/gateway-1/anthropic/v1/messages",
    )
    expect(Option.getOrThrow(resolveSharedProviderCredential(env, url))).toEqual({
      kind: "cloudflare-provider-native",
      secretName: CLOUDFLARE_AI_GATEWAY_RUN_TOKEN_SECRET,
    })
    expect(
      Option.isNone(
        resolveSharedProviderCredential(
          env,
          new URL(
            "https://gateway.ai.cloudflare.com/v1/account-1/another-gateway/openai/v1/responses",
          ),
        ),
      ),
    ).toBe(true)

    const request = new Request(url, {
      headers: {
        authorization: "Bearer encrypted-proxy-placeholder",
        cookie: "session=secret",
      },
    })
    const forwarded = requestWithCloudflareProviderNativeCredential(
      request,
      "gateway-run-token",
      Option.some("anthropic-key"),
    )
    expect(forwarded.headers.get("cf-aig-authorization")).toBe("Bearer gateway-run-token")
    expect(forwarded.headers.get("x-api-key")).toBe("anthropic-key")
    expect(forwarded.headers.has("authorization")).toBe(false)
    expect(forwarded.headers.has("cookie")).toBe(false)
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

  it("returns actionable Cloudflare billing errors without hiding the upstream status", async () => {
    const response = await normalizeCloudflareAiGatewayResponse(
      Response.json({ error: "Payment Required" }, { status: 402 }),
    )
    const body = (await response.json()) as { error: { code: string; message: string } }

    expect(response.status).toBe(402)
    expect(body.error.code).toBe("payment_required")
    expect(body.error.message).toContain(CLOUDFLARE_AI_GATEWAY_UNIFIED_BILLING_DOCS_URL)
    expect(body.error.message).toContain(CLOUDFLARE_AI_GATEWAY_TOP_UP_URL)
  })

  it("returns actionable Workers AI free-allocation errors", async () => {
    const response = await normalizeCloudflareAiGatewayResponse(
      Response.json(
        {
          errors: [
            {
              code: 3036,
              message: "You have used up your daily free allocation of 10,000 neurons.",
            },
          ],
        },
        { status: 429 },
      ),
    )
    const body = (await response.json()) as { error: { code: string; message: string } }

    expect(response.status).toBe(429)
    expect(body.error.code).toBe("free_allocation_exhausted")
    expect(body.error.message).toContain(CLOUDFLARE_WORKERS_AI_PRICING_DOCS_URL)
    expect(body.error.message).toContain(CLOUDFLARE_AI_GATEWAY_TOP_UP_URL)
  })
})
