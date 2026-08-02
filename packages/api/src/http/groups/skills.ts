import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { CommonErrors } from "../errors"
import {
  AgentSkillParams,
  AgentSkillPreferencePayload,
  AgentSkillsResponse,
} from "../schemas/skills"
import { ControlPlaneAuth } from "../security"

export class SkillsGroup extends HttpApiGroup.make("skills")
  .add(
    HttpApiEndpoint.get("list", "/", {
      success: AgentSkillsResponse,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "List global Agent Skills" })),
    HttpApiEndpoint.put("setPreference", "/:skillId/preference", {
      params: AgentSkillParams,
      payload: AgentSkillPreferencePayload,
      success: AgentSkillsResponse,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "Set an Agent Skill preference" })),
    HttpApiEndpoint.delete("clearPreference", "/:skillId/preference", {
      params: AgentSkillParams,
      success: AgentSkillsResponse,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "Reset an Agent Skill preference" })),
  )
  .prefix("/skills")
  .middleware(ControlPlaneAuth) {}
