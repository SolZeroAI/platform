import { S0Api } from "@solzero/api"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { clearPreference, list, setPreference } from "../handlers/skills"
import { observeRoute } from "../services/observability"

export const HttpSkillsLive = HttpApiBuilder.group(S0Api, "skills", (handlers) =>
  handlers
    .handle("list", () => observeRoute("skills", "list", list()))
    .handle("setPreference", (input) =>
      observeRoute("skills", "setPreference", setPreference(input)),
    )
    .handle("clearPreference", (input) =>
      observeRoute("skills", "clearPreference", clearPreference(input)),
    ),
)
