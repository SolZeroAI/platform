import { Schema } from "effect"

export const ReposListQuery = {
  q: Schema.optionalKey(Schema.String),
  owner: Schema.optionalKey(Schema.String),
  visibility: Schema.optionalKey(Schema.String),
  sort: Schema.optionalKey(Schema.String),
  order: Schema.optionalKey(Schema.String),
  page: Schema.optionalKey(Schema.String),
  perPage: Schema.optionalKey(Schema.String),
}

export type ReposListQuery = {
  q?: string
  owner?: string
  visibility?: string
  sort?: string
  order?: string
  page?: string
  perPage?: string
}

export const RepoParams = {
  owner: Schema.String,
  name: Schema.String,
}

export type RepoParams = { owner: string; name: string }

export const RepoMetadataPayload = Schema.Struct({
  description: Schema.optionalKey(Schema.String),
  aliases: Schema.optionalKey(Schema.Array(Schema.String)),
  channelAssociations: Schema.optionalKey(Schema.Array(Schema.String)),
  keywords: Schema.optionalKey(Schema.Array(Schema.String)),
})

export type RepoMetadataPayload = typeof RepoMetadataPayload.Type

export const RepoOwnerSummary = Schema.Struct({
  login: Schema.String,
  type: Schema.String,
})

const RepositoryAccess = Schema.NullOr(Schema.Literals(["read", "write"]))

export const RepositoryPermissions = Schema.Struct({
  contents: RepositoryAccess,
  pullRequests: RepositoryAccess,
  metadata: RepositoryAccess,
  userCanPull: Schema.Boolean,
  userCanPush: Schema.Boolean,
  userCanAdmin: Schema.Boolean,
  canPush: Schema.Boolean,
  canOpenPullRequests: Schema.Boolean,
})

/** A GitHub repository that both the user and the GitHub App can reach, with its stored metadata. */
export const EnrichedRepositorySummary = Schema.Struct({
  id: Schema.Number,
  owner: Schema.String,
  name: Schema.String,
  fullName: Schema.String,
  description: Schema.NullOr(Schema.String),
  private: Schema.Boolean,
  defaultBranch: Schema.String,
  installationId: Schema.optionalKey(Schema.Number),
  permissions: Schema.optionalKey(RepositoryPermissions),
  metadata: Schema.optionalKey(RepoMetadataPayload),
})

export type EnrichedRepositorySummary = typeof EnrichedRepositorySummary.Type

export const ReposPagination = Schema.Struct({
  page: Schema.Number,
  perPage: Schema.Number,
  totalCount: Schema.NullOr(Schema.Number),
  hasMore: Schema.Boolean,
})

export class ReposListResponse extends Schema.Class<ReposListResponse>("ReposListResponse")({
  repos: Schema.Array(EnrichedRepositorySummary),
  githubAppInstallUrl: Schema.optionalKey(Schema.NullOr(Schema.String)),
  owners: Schema.optionalKey(Schema.Array(RepoOwnerSummary)),
  pagination: Schema.optionalKey(ReposPagination),
}) {}

export class RepoMetadataResponse extends Schema.Class<RepoMetadataResponse>(
  "RepoMetadataResponse",
)({
  repo: Schema.String,
  metadata: Schema.NullOr(RepoMetadataPayload),
}) {}
