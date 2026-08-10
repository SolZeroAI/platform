import {
  cloudflareAiGatewayByokProviderForModel,
  CLOUDFLARE_AI_GATEWAY_PROVIDER_ID,
  type CloudflareAiGatewayByokKeyMap,
} from "@solzero/shared"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import { encryptSecret } from "../auth/crypto"
import type { Env } from "../types"
import {
  CLOUDFLARE_AI_GATEWAY_BYOK_PROXY_PREFIX,
  CLOUDFLARE_AI_GATEWAY_STORED_KEY_PLACEHOLDER,
  cloudflareAiGatewayProviderNativeBaseUrl,
} from "./cloudflare-ai-gateway"

type SharedProviderCredentialMode = "direct" | "opencode_proxy"

function nonEmptyString(value: string | null | undefined): Option.Option<string> {
  return Option.fromNullishOr(value).pipe(
    Option.map((resolved) => resolved.trim()),
    Option.filter((resolved) => resolved.length > 0),
  )
}

async function encryptContainerCredential(env: Env, apiKey: string): Promise<string> {
  const encryptionKey = Option.getOrThrowWith(
    nonEmptyString(env.TOKEN_ENCRYPTION_KEY),
    () => new Error("TOKEN_ENCRYPTION_KEY not configured"),
  )
  // oxlint-disable-next-line effect/effect-run-in-body -- Promise boundary for OpenCode config compilation.
  const encrypted = await Effect.runPromise(encryptSecret(apiKey, encryptionKey))
  return `${CLOUDFLARE_AI_GATEWAY_BYOK_PROXY_PREFIX}${encrypted}`
}

async function compileSelectedProviderOptions(
  input: {
    env: Env
    providerOptions?: Record<string, unknown>
    providerKeys?: CloudflareAiGatewayByokKeyMap
    selectedModelId: string
    credentialMode: SharedProviderCredentialMode
    storedProxyCredential: string
  },
  provider: NonNullable<ReturnType<typeof cloudflareAiGatewayByokProviderForModel>>,
): Promise<Option.Option<Record<string, unknown>>> {
  const baseURL = Option.getOrThrowWith(
    cloudflareAiGatewayProviderNativeBaseUrl(input.env, input.selectedModelId),
    () =>
      new Error(
        `Cloudflare AI Gateway provider-native URL is unavailable for '${input.selectedModelId}'`,
      ),
  )
  const apiKey = Option.fromNullishOr(input.providerKeys?.[provider.id])
  const credential = await Match.value(input.credentialMode).pipe(
    Match.when("direct", () =>
      Promise.resolve(Option.getOrElse(apiKey, () => CLOUDFLARE_AI_GATEWAY_STORED_KEY_PLACEHOLDER)),
    ),
    Match.orElse(() =>
      Option.match(apiKey, {
        onNone: () => Promise.resolve(input.storedProxyCredential),
        onSome: (value) => encryptContainerCredential(input.env, value),
      }),
    ),
  )
  return Option.some({
    ...input.providerOptions,
    apiKey: credential,
    baseURL,
    s0CloudflareStoredKey: Option.isNone(apiKey),
  })
}

export async function compileCloudflareAiGatewayProviderOptions(input: {
  env: Env
  providerId: string
  providerOptions?: Record<string, unknown>
  providerKeys?: CloudflareAiGatewayByokKeyMap
  selectedProviderId: string
  selectedModelId: string
  credentialMode: SharedProviderCredentialMode
  storedProxyCredential: string
}): Promise<Option.Option<Record<string, unknown>>> {
  const byokProvider = Option.fromNullishOr(
    cloudflareAiGatewayByokProviderForModel(input.selectedModelId),
  ).pipe(
    Option.filter(
      () =>
        input.providerId === CLOUDFLARE_AI_GATEWAY_PROVIDER_ID &&
        input.providerId === input.selectedProviderId,
    ),
  )
  return await Option.match(byokProvider, {
    onNone: () => Promise.resolve(Option.none<Record<string, unknown>>()),
    onSome: (provider) => compileSelectedProviderOptions(input, provider),
  })
}
