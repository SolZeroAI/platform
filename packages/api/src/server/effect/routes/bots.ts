import { S0Api } from "@solzero/api"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import {
  completeRoutine,
  create,
  createRoutine,
  deleteRoutine,
  get,
  list,
  listRoutines,
  open,
} from "../handlers/bots"
import { observeRoute } from "../services/observability"

export const HttpBotsLive = HttpApiBuilder.group(S0Api, "bots", (handlers) =>
  handlers
    .handle("list", () => observeRoute("bots", "list", list()))
    .handle("create", (input) => observeRoute("bots", "create", create(input)))
    .handle("get", (input) => observeRoute("bots", "get", get(input)))
    .handle("open", (input) => observeRoute("bots", "open", open(input)))
    .handle("listRoutines", (input) => observeRoute("bots", "listRoutines", listRoutines(input)))
    .handle("createRoutine", (input) => observeRoute("bots", "createRoutine", createRoutine(input)))
    .handle("completeRoutine", (input) =>
      observeRoute("bots", "completeRoutine", completeRoutine(input)),
    )
    .handle("deleteRoutine", (input) =>
      observeRoute("bots", "deleteRoutine", deleteRoutine(input)),
    ),
)
