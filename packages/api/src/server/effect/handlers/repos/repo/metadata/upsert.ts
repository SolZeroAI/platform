import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type { RepoMetadataPayload, RepoParams } from "@c0/api"
import { RepoMetadataStore } from "../../../../../background/db/repo-metadata"
import { json, resolveIdentityAndRepo, runControlPlane } from "../../../shared/control-plane"

export function upsertMetadata({
  params,
  payload,
}: {
  params: RepoParams
  payload: RepoMetadataPayload
}) {
  return runControlPlane(
    Effect.fn("repos.metadata.upsert")(function* ({
      request,
      env,
      principal,
      identityProvider,
      githubProvider,
    }) {
      const repoAuth = yield* resolveIdentityAndRepo(
        request,
        env,
        principal,
        params.owner,
        params.name,
        { identityProvider, githubProvider },
      )

      const aliases = Option.getOrUndefined(
        Option.map(Option.fromNullishOr(payload.aliases), (value) => [...value]),
      )
      const channelAssociations = Option.getOrUndefined(
        Option.map(Option.fromNullishOr(payload.channelAssociations), (value) => [...value]),
      )
      const keywords = Option.getOrUndefined(
        Option.map(Option.fromNullishOr(payload.keywords), (value) => [...value]),
      )
      const metadata = {
        ...payload,
        aliases,
        channelAssociations,
        keywords,
      }
      const store = new RepoMetadataStore(env.DB)
      yield* store.upsert(repoAuth.repo.repoOwner, repoAuth.repo.repoName, metadata)
      return json({
        status: "updated",
        repo: `${repoAuth.repo.repoOwner}/${repoAuth.repo.repoName}`,
        metadata,
      })
    }),
  )
}
