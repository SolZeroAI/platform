import { Schema } from "effect"

export const AgentSkillOrigin = Schema.Literals(["built-in", "admin", "skills-sh", "user"])
export const AgentSkillRuntimeScope = Schema.Literals(["harness", "isolate", "all"])

export class AgentSkillItem extends Schema.Class<AgentSkillItem>("AgentSkillItem")({
  id: Schema.String,
  slug: Schema.String,
  name: Schema.String,
  description: Schema.String,
  origin: AgentSkillOrigin,
  runtimeScope: AgentSkillRuntimeScope,
  defaultEnabled: Schema.Boolean,
  enabled: Schema.Boolean,
  overridden: Schema.Boolean,
}) {}

export class AgentSkillsResponse extends Schema.Class<AgentSkillsResponse>("AgentSkillsResponse")({
  skills: Schema.Array(AgentSkillItem),
}) {}

export class AgentSkillPreferencePayload extends Schema.Class<AgentSkillPreferencePayload>(
  "AgentSkillPreferencePayload",
)({
  enabled: Schema.Boolean,
}) {}

export class AgentSkillParams extends Schema.Class<AgentSkillParams>("AgentSkillParams")({
  skillId: Schema.String,
}) {}

export class AdminAgentSkillItem extends Schema.Class<AdminAgentSkillItem>("AdminAgentSkillItem")({
  id: Schema.String,
  slug: Schema.String,
  name: Schema.String,
  description: Schema.String,
  origin: AgentSkillOrigin,
  runtimeScope: AgentSkillRuntimeScope,
  sourceId: Schema.NullOr(Schema.String),
  sourceHash: Schema.NullOr(Schema.String),
  contentHash: Schema.String,
  defaultEnabled: Schema.Boolean,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
}) {}

export class AdminAgentSkillsResponse extends Schema.Class<AdminAgentSkillsResponse>(
  "AdminAgentSkillsResponse",
)({
  skills: Schema.Array(AdminAgentSkillItem),
}) {}

export class AdminAgentSkillCreatePayload extends Schema.Class<AdminAgentSkillCreatePayload>(
  "AdminAgentSkillCreatePayload",
)({
  skillMd: Schema.String,
  defaultEnabled: Schema.Boolean,
}) {}

export class AdminAgentSkillDefaultPayload extends Schema.Class<AdminAgentSkillDefaultPayload>(
  "AdminAgentSkillDefaultPayload",
)({
  defaultEnabled: Schema.Boolean,
}) {}
