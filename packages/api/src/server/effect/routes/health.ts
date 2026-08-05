import { HttpApiBuilder } from "effect/unstable/httpapi"
import { S0Api } from "@solzero/api"
import { get } from "../handlers/health/get"
import { head } from "../handlers/health/head"
import { observeRoute } from "../services/observability"

export const HttpHealthLive = HttpApiBuilder.group(S0Api, "health", (handlers) =>
  handlers
    .handle("get", () => observeRoute("health", "get", get()))
    .handle("head", () => observeRoute("health", "head", head())),
)
