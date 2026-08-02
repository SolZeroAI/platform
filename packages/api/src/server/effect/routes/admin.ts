import { HttpApiBuilder } from "effect/unstable/httpapi"
import { C0Api } from "@c0/api"
import {
  access,
  agentSkills,
  aiProviders,
  aiSearch,
  archiveSession,
  archiveWorkflow,
  createAiSearchSource,
  createAgentSkill,
  deleteAiSearchSource,
  deleteAgentSkill,
  deleteSession,
  exportAiSearchConfig,
  exportMcpcfConfig,
  exportLitellmProvider,
  githubAccountCleanup,
  githubAccountCleanupPreview,
  mcpcf,
  refreshMcpcf,
  resetMcpcfConfig,
  resetLitellmProvider,
  retryWorkflowRun,
  runWorkflow,
  session,
  sessions,
  syncLitellmModels,
  stopSession,
  summary,
  unarchiveSession,
  unarchiveWorkflow,
  updateLitellmProvider,
  updateAiSearchSource,
  updateAgentSkill,
  updateMcpcfConfig,
  workflowRunEvents,
  workflowRuns,
  workflows,
} from "../handlers/admin"
import { observeRoute } from "../services/observability"

export const HttpAdminLive = HttpApiBuilder.group(C0Api, "admin", (handlers) =>
  handlers
    .handle("summary", () => observeRoute("admin", "summary", summary()))
    .handle("access", () => observeRoute("admin", "access", access()))
    .handle("sessions", (input) => observeRoute("admin", "sessions", sessions(input)))
    .handle("session", (input) => observeRoute("admin", "session", session(input)))
    .handle("stopSession", (input) => observeRoute("admin", "stopSession", stopSession(input)))
    .handle("archiveSession", (input) =>
      observeRoute("admin", "archiveSession", archiveSession(input)),
    )
    .handle("unarchiveSession", (input) =>
      observeRoute("admin", "unarchiveSession", unarchiveSession(input)),
    )
    .handle("deleteSession", (input) =>
      observeRoute("admin", "deleteSession", deleteSession(input)),
    )
    .handle("workflows", (input) => observeRoute("admin", "workflows", workflows(input)))
    .handle("workflowRuns", (input) => observeRoute("admin", "workflowRuns", workflowRuns(input)))
    .handle("workflowRunEvents", (input) =>
      observeRoute("admin", "workflowRunEvents", workflowRunEvents(input)),
    )
    .handle("githubAccountCleanupPreview", () =>
      observeRoute("admin", "githubAccountCleanupPreview", githubAccountCleanupPreview()),
    )
    .handle("githubAccountCleanup", () =>
      observeRoute("admin", "githubAccountCleanup", githubAccountCleanup()),
    )
    .handle("mcpcf", () => observeRoute("admin", "mcpcf", mcpcf()))
    .handle("updateMcpcfConfig", (input) =>
      observeRoute("admin", "updateMcpcfConfig", updateMcpcfConfig(input)),
    )
    .handle("resetMcpcfConfig", () => observeRoute("admin", "resetMcpcfConfig", resetMcpcfConfig()))
    .handle("exportMcpcfConfig", () =>
      observeRoute("admin", "exportMcpcfConfig", exportMcpcfConfig()),
    )
    .handle("refreshMcpcf", () => observeRoute("admin", "refreshMcpcf", refreshMcpcf()))
    .handle("aiProviders", () => observeRoute("admin", "aiProviders", aiProviders()))
    .handle("aiSearch", () => observeRoute("admin", "aiSearch", aiSearch()))
    .handle("agentSkills", () => observeRoute("admin", "agentSkills", agentSkills()))
    .handle("createAgentSkill", (input) =>
      observeRoute("admin", "createAgentSkill", createAgentSkill(input)),
    )
    .handle("updateAgentSkill", (input) =>
      observeRoute("admin", "updateAgentSkill", updateAgentSkill(input)),
    )
    .handle("deleteAgentSkill", (input) =>
      observeRoute("admin", "deleteAgentSkill", deleteAgentSkill(input)),
    )
    .handle("exportAiSearchConfig", () =>
      observeRoute("admin", "exportAiSearchConfig", exportAiSearchConfig()),
    )
    .handle("createAiSearchSource", (input) =>
      observeRoute("admin", "createAiSearchSource", createAiSearchSource(input)),
    )
    .handle("updateAiSearchSource", (input) =>
      observeRoute("admin", "updateAiSearchSource", updateAiSearchSource(input)),
    )
    .handle("deleteAiSearchSource", (input) =>
      observeRoute("admin", "deleteAiSearchSource", deleteAiSearchSource(input)),
    )
    .handle("updateLitellmProvider", (input) =>
      observeRoute("admin", "updateLitellmProvider", updateLitellmProvider(input)),
    )
    .handle("resetLitellmProvider", () =>
      observeRoute("admin", "resetLitellmProvider", resetLitellmProvider()),
    )
    .handle("exportLitellmProvider", () =>
      observeRoute("admin", "exportLitellmProvider", exportLitellmProvider()),
    )
    .handle("syncLitellmModels", () =>
      observeRoute("admin", "syncLitellmModels", syncLitellmModels()),
    )
    .handle("runWorkflow", (input) => observeRoute("admin", "runWorkflow", runWorkflow(input)))
    .handle("retryWorkflowRun", (input) =>
      observeRoute("admin", "retryWorkflowRun", retryWorkflowRun(input)),
    )
    .handle("archiveWorkflow", (input) =>
      observeRoute("admin", "archiveWorkflow", archiveWorkflow(input)),
    )
    .handle("unarchiveWorkflow", (input) =>
      observeRoute("admin", "unarchiveWorkflow", unarchiveWorkflow(input)),
    ),
)
