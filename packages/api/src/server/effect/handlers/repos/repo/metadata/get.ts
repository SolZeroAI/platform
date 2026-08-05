import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type { RepoParams } from "@solzero/api"
import { RepoMetadataStore } from "../../../../../background/db/repo-metadata"
import { json, resolveIdentityAndRepo, runControlPlane } from "../../../shared/control-plane"

export function getMetadata({ params }: { params: RepoParams }) {
  return runControlPlane(
    Effect.fn("repos.metadata.get")(function* ({
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
      const store = new RepoMetadataStore(env.DB)
      const metadata = yield* store.get(repoAuth.repo.repoOwner, repoAuth.repo.repoName)
      return json({
        repo: `${repoAuth.repo.repoOwner}/${repoAuth.repo.repoName}`,
        metadata: Option.getOrNull(metadata),
      })
    }),
  )
}
