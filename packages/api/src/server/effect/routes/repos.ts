import { HttpApiBuilder } from "effect/unstable/httpapi"
import { C0Api } from "@c0/api"
import { list } from "../handlers/repos/list"
import { getMetadata } from "../handlers/repos/repo/metadata/get"
import { upsertMetadata } from "../handlers/repos/repo/metadata/upsert"
import { observeRoute } from "../services/observability"

export const HttpReposLive = HttpApiBuilder.group(C0Api, "repos", (handlers) =>
  handlers
    .handle("list", () => observeRoute("repos", "list", list()))
    .handle("upsertMetadata", (input) =>
      observeRoute("repos", "upsertMetadata", upsertMetadata(input)),
    )
    .handle("getMetadata", (input) => observeRoute("repos", "getMetadata", getMetadata(input))),
)
