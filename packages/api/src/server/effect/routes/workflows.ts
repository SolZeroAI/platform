import { HttpApiBuilder } from "effect/unstable/httpapi"
import { C0Api } from "@c0/api"
import { builderDraftLatest } from "../handlers/workflows/builder-drafts"
import { deleteWorkflow } from "../handlers/workflows/delete"
import { exportWorkflow } from "../handlers/workflows/export"
import { get } from "../handlers/workflows/get"
import { list } from "../handlers/workflows/list"
import {
  approveRun,
  deleteRun,
  getRun,
  runArtifactContent,
  runEvents,
  runEventsStream,
  runs,
} from "../handlers/workflows/runs"
import {
  getWorkflowSlackApp,
  updateWorkflowSlackAppCredentials,
} from "../handlers/workflows/slack-app"
import { disableWorkflow, enableWorkflow } from "../handlers/workflows/status"
import {
  catalog,
  createWorkflow as create,
  runWorkflow as run,
  updateWorkflow as update,
  updateWorkflowName,
} from "../handlers/workflows/shared"
import { observeRoute } from "../services/observability"

export const HttpWorkflowsLive = HttpApiBuilder.group(C0Api, "workflows", (handlers) =>
  handlers
    .handle("catalog", () => observeRoute("workflows", "catalog", catalog()))
    .handle("list", (input) => observeRoute("workflows", "list", list(input)))
    .handle("create", (input) => observeRoute("workflows", "create", create(input)))
    .handle("builderDraftLatest", (input) =>
      observeRoute("workflows", "builderDraftLatest", builderDraftLatest(input)),
    )
    .handle("export", (input) => observeRoute("workflows", "export", exportWorkflow(input)))
    .handle("get", (input) => observeRoute("workflows", "get", get(input)))
    .handle("update", (input) => observeRoute("workflows", "update", update(input)))
    .handle("updateName", (input) =>
      observeRoute("workflows", "updateName", updateWorkflowName(input)),
    )
    .handle("disable", (input) => observeRoute("workflows", "disable", disableWorkflow(input)))
    .handle("enable", (input) => observeRoute("workflows", "enable", enableWorkflow(input)))
    .handle("slackApp", (input) =>
      observeRoute("workflows", "slackApp", getWorkflowSlackApp(input)),
    )
    .handle("slackAppCredentials", (input) =>
      observeRoute("workflows", "slackAppCredentials", updateWorkflowSlackAppCredentials(input)),
    )
    .handle("delete", (input) => observeRoute("workflows", "delete", deleteWorkflow(input)))
    .handle("run", (input) => observeRoute("workflows", "run", run(input)))
    .handle("getRun", (input) => observeRoute("workflows", "getRun", getRun(input)))
    .handle("deleteRun", (input) => observeRoute("workflows", "deleteRun", deleteRun(input)))
    .handle("runs", (input) => observeRoute("workflows", "runs", runs(input)))
    .handle("runEvents", (input) => observeRoute("workflows", "runEvents", runEvents(input)))
    .handle("runArtifactContent", (input) =>
      observeRoute("workflows", "runArtifactContent", runArtifactContent(input)),
    )
    .handle("approveRun", (input) => observeRoute("workflows", "approveRun", approveRun(input)))
    .handle("runEventsStream", (input) =>
      observeRoute("workflows", "runEventsStream", runEventsStream(input)),
    ),
)
