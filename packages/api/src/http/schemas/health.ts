import { Schema } from "effect"

export class HealthResponse extends Schema.Class<HealthResponse>("HealthResponse")({
  status: Schema.String,
  service: Schema.String,
  version: Schema.String,
  configDigest: Schema.String,
}) {}
