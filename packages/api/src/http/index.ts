import { HttpApi, OpenApi } from "effect/unstable/httpapi"
import { AdminGroup } from "./groups/admin"
import { AuthGroup } from "./groups/auth"
import { HealthGroup } from "./groups/health"
import { ProvidersGroup } from "./groups/providers"
import { ReposGroup } from "./groups/repos"
import { SecretsGroup } from "./groups/secrets"
import { SessionsGroup } from "./groups/sessions"
import { SkillsGroup } from "./groups/skills"
import { SlackGroup } from "./groups/slack"
import { WorkflowsGroup } from "./groups/workflows"

export class S0Api extends HttpApi.make("S0Api")
  .add(HealthGroup)
  .add(AdminGroup)
  .add(AuthGroup)
  .add(ProvidersGroup)
  .add(SessionsGroup)
  .add(SkillsGroup)
  .add(SlackGroup)
  .add(WorkflowsGroup)
  .add(ReposGroup)
  .add(SecretsGroup)
  .annotateMerge(
    OpenApi.annotations({
      title: "SolZero Agent API",
      description: "API for SolZero Agent",
      version: "0.1.0",
    }),
  ) {}

export * from "./errors"
export * from "./groups"
export * from "./schemas"
export * from "./security"
