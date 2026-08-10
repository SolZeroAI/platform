export const CLOUDFLARE_AI_GATEWAY_PROVIDER_ID = "cloudflare-ai-gateway"

export const CLOUDFLARE_AI_GATEWAY_BYOK_PROVIDERS = [
  {
    id: "openai",
    name: "OpenAI",
    providerSlug: "openai",
    modelPrefix: "openai/",
    userOverrideProviderId: "cloudflare-ai-gateway-byok-openai",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    providerSlug: "anthropic",
    modelPrefix: "anthropic/",
    userOverrideProviderId: "cloudflare-ai-gateway-byok-anthropic",
  },
  {
    id: "xai",
    name: "xAI",
    providerSlug: "grok",
    modelPrefix: "xai/",
    userOverrideProviderId: "cloudflare-ai-gateway-byok-xai",
  },
] as const

export type CloudflareAiGatewayByokProvider =
  (typeof CLOUDFLARE_AI_GATEWAY_BYOK_PROVIDERS)[number]["id"]

export type CloudflareAiGatewayByokKeyMap = Partial<Record<CloudflareAiGatewayByokProvider, string>>

export function cloudflareAiGatewayByokProviderForModel(
  modelId: string,
): (typeof CLOUDFLARE_AI_GATEWAY_BYOK_PROVIDERS)[number] | undefined {
  return CLOUDFLARE_AI_GATEWAY_BYOK_PROVIDERS.find((provider) =>
    modelId.startsWith(provider.modelPrefix),
  )
}

export function cloudflareAiGatewayByokProviderForOverrideId(
  providerId: string,
): (typeof CLOUDFLARE_AI_GATEWAY_BYOK_PROVIDERS)[number] | undefined {
  return CLOUDFLARE_AI_GATEWAY_BYOK_PROVIDERS.find(
    (provider) => provider.userOverrideProviderId === providerId,
  )
}
