import { HttpApiBuilder } from "effect/unstable/httpapi"
import { C0Api } from "@c0/api"
import { create } from "../handlers/sessions/create"
import { artifacts } from "../handlers/sessions/id/artifacts"
import { deleteSession } from "../handlers/sessions/id/delete"
import { events } from "../handlers/sessions/id/events"
import { get } from "../handlers/sessions/id/get"
import { messages } from "../handlers/sessions/id/messages"
import { prompt } from "../handlers/sessions/id/prompt"
import { resume } from "../handlers/sessions/id/resume"
import { sandboxActivity } from "../handlers/sessions/id/sandbox-activity"
import { stop } from "../handlers/sessions/id/stop"
import { tools } from "../handlers/sessions/id/tools"
import { wsToken } from "../handlers/sessions/id/ws-token"
import { archive } from "../handlers/sessions/id/archive"
import { unarchive } from "../handlers/sessions/id/unarchive"
import { aiSearchSources } from "../handlers/sessions/ai-search"
import {
  mcpcfContextForgeTokenSettings,
  mcpcfServers,
  mcpcfSettings,
  mcpcfTools,
  updateMcpcfContextForgeTokenSettings,
  updateMcpcfSettings,
} from "../handlers/sessions/mcpcf-tools"
import { createIsolate } from "../handlers/sessions/isolate"
import { list } from "../handlers/sessions/list"
import { run } from "../handlers/sessions/run"
import { createSandbox } from "../handlers/sessions/sandbox"
import { createSlack } from "../handlers/sessions/slack"
import { observeRoute } from "../services/observability"

export const HttpSessionsLive = HttpApiBuilder.group(C0Api, "sessions", (handlers) =>
  handlers
    .handle("list", (input) => observeRoute("sessions", "list", list(input)))
    .handle("create", (input) => observeRoute("sessions", "create", create(input)))
    .handle("createIsolate", (input) =>
      observeRoute("sessions", "createIsolate", createIsolate(input)),
    )
    .handle("createSandbox", (input) =>
      observeRoute("sessions", "createSandbox", createSandbox(input)),
    )
    .handle("run", (input) => observeRoute("sessions", "run", run(input)))
    .handle("createSlack", (input) => observeRoute("sessions", "createSlack", createSlack(input)))
    .handle("aiSearchSources", () => observeRoute("sessions", "aiSearchSources", aiSearchSources()))
    .handle("mcpcfServers", () => observeRoute("sessions", "mcpcfServers", mcpcfServers()))
    .handle("mcpcfTools", (input) => observeRoute("sessions", "mcpcfTools", mcpcfTools(input)))
    .handle("mcpcfSettings", (input) =>
      observeRoute("sessions", "mcpcfSettings", mcpcfSettings(input)),
    )
    .handle("mcpcfContextForgeTokenSettings", () =>
      observeRoute("sessions", "mcpcfContextForgeTokenSettings", mcpcfContextForgeTokenSettings()),
    )
    .handle("updateMcpcfContextForgeTokenSettings", (input) =>
      observeRoute(
        "sessions",
        "updateMcpcfContextForgeTokenSettings",
        updateMcpcfContextForgeTokenSettings(input),
      ),
    )
    .handle("updateMcpcfSettings", (input) =>
      observeRoute("sessions", "updateMcpcfSettings", updateMcpcfSettings(input)),
    )
    .handle("get", (input) => observeRoute("sessions", "get", get(input)))
    .handle("delete", (input) => observeRoute("sessions", "delete", deleteSession(input)))
    .handle("tools", (input) => observeRoute("sessions", "tools", tools(input)))
    .handle("prompt", (input) => observeRoute("sessions", "prompt", prompt(input)))
    .handle("resume", (input) => observeRoute("sessions", "resume", resume(input)))
    .handle("stop", (input) => observeRoute("sessions", "stop", stop(input)))
    .handle("events", (input) => observeRoute("sessions", "events", events(input)))
    .handle("sandboxActivity", (input) =>
      observeRoute("sessions", "sandboxActivity", sandboxActivity(input)),
    )
    .handle("messages", (input) => observeRoute("sessions", "messages", messages(input)))
    .handle("artifacts", (input) => observeRoute("sessions", "artifacts", artifacts(input)))
    .handle("wsToken", (input) => observeRoute("sessions", "wsToken", wsToken(input)))
    .handle("archive", (input) => observeRoute("sessions", "archive", archive(input)))
    .handle("unarchive", (input) => observeRoute("sessions", "unarchive", unarchive(input))),
)
