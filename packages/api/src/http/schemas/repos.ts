import { Schema } from "effect"
import { JsonRecord } from "./common"

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

export const ReposPagination = Schema.Struct({
  page: Schema.Number,
  perPage: Schema.Number,
  totalCount: Schema.NullOr(Schema.Number),
  hasMore: Schema.Boolean,
})

export class ReposListResponse extends Schema.Class<ReposListResponse>("ReposListResponse")({
  repos: Schema.Array(JsonRecord),
  githubAppInstallUrl: Schema.optionalKey(Schema.NullOr(Schema.String)),
  owners: Schema.optionalKey(Schema.Array(RepoOwnerSummary)),
  pagination: Schema.optionalKey(ReposPagination),
}) {}

export class RepoMetadataResponse extends Schema.Class<RepoMetadataResponse>(
  "RepoMetadataResponse",
)({
  repo: Schema.String,
  metadata: Schema.NullOr(JsonRecord),
}) {}
