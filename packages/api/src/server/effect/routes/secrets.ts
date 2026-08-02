import { HttpApiBuilder } from "effect/unstable/httpapi"
import { C0Api } from "@c0/api"
import { deleteSecret } from "../handlers/secrets/key"
import { list } from "../handlers/secrets/list"
import { set } from "../handlers/secrets/set"
import { listTags } from "../handlers/secrets/tags"
import { observeRoute } from "../services/observability"

export const HttpSecretsLive = HttpApiBuilder.group(C0Api, "secrets", (handlers) =>
  handlers
    .handle("set", (input) => observeRoute("secrets", "set", set(input)))
    .handle("list", (input) => observeRoute("secrets", "list", list(input)))
    .handle("tags", () => observeRoute("secrets", "tags", listTags()))
    .handle("delete", (input) => observeRoute("secrets", "delete", deleteSecret(input))),
)
