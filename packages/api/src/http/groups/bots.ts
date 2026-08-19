import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { CommonErrors, NotFoundError } from "../errors"
import {
  BotIdParams,
  BotListResponse,
  BotRoutineListResponse,
  BotRoutineParams,
  BotRoutineResponse,
  BotResponse,
  CreateBotPayload,
  CreateBotRoutinePayload,
  CreatedBotResponse,
  DeletedBotRoutineResponse,
  OpenBotPayload,
  OpenBotResponse,
} from "../schemas/bots"
import { ControlPlaneAuth } from "../security"

export class BotsGroup extends HttpApiGroup.make("bots")
  .add(
    HttpApiEndpoint.get("list", "/", {
      success: BotListResponse,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "List bots" })),
    HttpApiEndpoint.post("create", "/", {
      payload: CreateBotPayload,
      success: CreatedBotResponse,
      error: CommonErrors,
    }).annotateMerge(OpenApi.annotations({ summary: "Create bot" })),
    HttpApiEndpoint.get("get", "/:id", {
      params: BotIdParams,
      success: BotResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "Get bot" })),
    HttpApiEndpoint.post("open", "/:id/open", {
      params: BotIdParams,
      payload: OpenBotPayload,
      success: OpenBotResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "Attach a session to a bot" })),
    HttpApiEndpoint.get("listRoutines", "/:id/routines", {
      params: BotIdParams,
      success: BotRoutineListResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "List bot routines" })),
    HttpApiEndpoint.post("createRoutine", "/:id/routines", {
      params: BotIdParams,
      payload: CreateBotRoutinePayload,
      success: BotRoutineResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "Create a bot routine" })),
    HttpApiEndpoint.post("completeRoutine", "/:id/routines/:routineId/complete", {
      params: BotRoutineParams,
      success: DeletedBotRoutineResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "Complete and delete a bot routine" })),
    HttpApiEndpoint.delete("deleteRoutine", "/:id/routines/:routineId", {
      params: BotRoutineParams,
      success: DeletedBotRoutineResponse,
      error: [NotFoundError, ...CommonErrors],
    }).annotateMerge(OpenApi.annotations({ summary: "Delete a bot routine" })),
  )
  .prefix("/bots")
  .middleware(ControlPlaneAuth) {}
