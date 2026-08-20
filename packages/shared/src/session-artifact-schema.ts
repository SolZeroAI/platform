import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import type { SessionArtifactMetadata } from "./types"

export const SessionArtifactMetadataSchema = Schema.Struct({
  mode: Schema.optional(Schema.Literal("manual_pr")),
  head: Schema.optional(Schema.String),
  base: Schema.optional(Schema.String),
  createPrUrl: Schema.optional(Schema.String),
  provider: Schema.optional(Schema.String),
  prNumber: Schema.optional(Schema.Number),
})

const decodeArtifactMetadata = Schema.decodeUnknownOption(SessionArtifactMetadataSchema, {
  onExcessProperty: "ignore",
})

export function parseSessionArtifactMetadata(
  value: unknown,
): Option.Option<SessionArtifactMetadata> {
  return decodeArtifactMetadata(value)
}
