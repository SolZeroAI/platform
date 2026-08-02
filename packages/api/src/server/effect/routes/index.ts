import * as Layer from "effect/Layer"
import { AuthMiddlewareLive } from "../services/auth"
import { HttpAdminLive } from "./admin"
import { HttpAuthLive } from "./auth"
import { HttpHealthLive } from "./health"
import { HttpProvidersLive } from "./providers"
import { HttpReposLive } from "./repos"
import { HttpSecretsLive } from "./secrets"
import { HttpSessionsLive } from "./sessions"
import { HttpSkillsLive } from "./skills"
import { HttpSlackLive } from "./slack"
import { HttpWorkflowsLive } from "./workflows"

export const HttpRoutesLive = Layer.mergeAll(
  HttpHealthLive,
  HttpAdminLive,
  HttpAuthLive,
  HttpProvidersLive,
  HttpSessionsLive,
  HttpSkillsLive,
  HttpSlackLive,
  HttpReposLive,
  HttpSecretsLive,
  HttpWorkflowsLive,
).pipe(Layer.provide(AuthMiddlewareLive))
