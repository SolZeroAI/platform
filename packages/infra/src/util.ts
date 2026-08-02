import * as Cloudflare from "alchemy/Cloudflare"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type { StageMetadata } from "@c0-agent/shared"
import { getAiSearchInstanceName } from "./aiSearch"

export interface CreateAiSearchR2Options {
  appName: string
  namespace: Cloudflare.AI.SearchNamespace
  stageMetadata: StageMetadata
  serviceName: string
  tokenId: string
}

export function createAiSearchR2(options: CreateAiSearchR2Options) {
  const { appName, namespace, stageMetadata, serviceName, tokenId } = options

  return Effect.gen(function* () {
    const aiSearchR2Bucket = yield* Cloudflare.R2.Bucket(`${serviceName}-r2`, {
      name: `${appName}-${serviceName}-r2-${stageMetadata.name}`,
    })

    const instanceId = getAiSearchInstanceName({
      appName,
      serviceName,
      stageName: stageMetadata.name,
    })
    const aiSearch = yield* Option.match(Option.fromNullishOr(tokenId || null), {
      onNone: () => Effect.succeed({ instanceId }),
      onSome: (serviceTokenId) =>
        Cloudflare.AI.Search(`${serviceName}-ai-search`, {
          instanceId,
          namespace,
          source: aiSearchR2Bucket,
          tokenId: serviceTokenId,
        }),
    })

    return { aiSearchR2Bucket, aiSearch }
  })
}
