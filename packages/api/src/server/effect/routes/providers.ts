import { HttpApiBuilder } from "effect/unstable/httpapi"
import { S0Api } from "@solzero/api"
import { list } from "../handlers/providers/list"
import { replace } from "../handlers/providers/replace"
import { observeRoute } from "../services/observability"

export const HttpProvidersLive = HttpApiBuilder.group(S0Api, "providers", (handlers) =>
  handlers
    .handle("list", () => observeRoute("providers", "list", list()))
    .handle("replace", (input) => observeRoute("providers", "replace", replace(input))),
)
