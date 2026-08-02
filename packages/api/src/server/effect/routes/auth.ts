import { HttpApiBuilder } from "effect/unstable/httpapi"
import { C0Api } from "@c0/api"
import { createApiKey, listApiKeys } from "../handlers/auth/api-keys"
import { deleteApiKey } from "../handlers/auth/api-keys/key-id"
import { session } from "../handlers/auth/session"
import { observeRoute } from "../services/observability"

export const HttpAuthLive = HttpApiBuilder.group(C0Api, "auth", (handlers) =>
  handlers
    .handle("session", () => observeRoute("auth", "session", session()))
    .handle("createApiKey", (input) => observeRoute("auth", "createApiKey", createApiKey(input)))
    .handle("listApiKeys", () => observeRoute("auth", "listApiKeys", listApiKeys()))
    .handle("deleteApiKey", (input) => observeRoute("auth", "deleteApiKey", deleteApiKey(input))),
)
