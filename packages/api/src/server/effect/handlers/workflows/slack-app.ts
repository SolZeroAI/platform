import type { WorkflowSlackAppCredentialsPayload } from "@c0/api"
import * as Effect from "effect/Effect"
import { readWorkflowManifest } from "../../../background/workflows/artifacts"
import {
  getWorkflowSlackAppSetup,
  storeWorkflowSlackAppCredentials,
  type WorkflowSlackAppSetup,
} from "../../../background/workflows/slack-apps"
import { parseJson } from "../../../lib/json"
import { json, runControlPlane } from "../shared/control-plane"
import { requireWorkflowForUser } from "./shared"

function formatSlackAppSetup(setup: WorkflowSlackAppSetup) {
  return {
    id: setup.app.id,
    workflowId: setup.app.workflow_id,
    appName: setup.app.app_name,
    status: setup.status,
    requestUrls: setup.requestUrls,
    manifest: setup.manifest,
    validation: setup.validation,
    registrations: setup.registrations.map((registration) => ({
      id: registration.id,
      workflowId: registration.workflow_id,
      workflowVersion: registration.workflow_version,
      nodeId: registration.node_id,
      surface: registration.surface,
      commandName: registration.command_name,
      eventTypes: parseJson(registration.event_types_json),
      channelNamePattern: registration.channel_name_pattern,
      keywordRules: parseJson(registration.keyword_rules_json),
      actionIds: parseJson(registration.action_ids_json),
      cooldownSeconds: registration.cooldown_seconds,
      dedupeWindowSeconds: registration.dedupe_window_seconds,
      enabled: registration.enabled,
      updatedAt: registration.updated_at,
    })),
  }
}

function publicServerUrl(request: Request): string {
  return new URL(request.url).origin
}

export function getWorkflowSlackApp({ params }: { params: { id: string } }) {
  return runControlPlane(
    Effect.fn("workflows.slackApp.get")(function* (context) {
      const { workflow } = yield* requireWorkflowForUser(context, params.id)
      const manifest = yield* readWorkflowManifest(context.env, workflow.manifest_key)
      const setup = yield* getWorkflowSlackAppSetup({
        env: context.env,
        workflow,
        manifest,
        serverUrl: publicServerUrl(context.request),
      })
      return json({ slackApp: formatSlackAppSetup(setup) })
    }),
  )
}

export function updateWorkflowSlackAppCredentials(input: {
  params: { id: string }
  payload: WorkflowSlackAppCredentialsPayload
}) {
  return runControlPlane(
    Effect.fn("workflows.slackApp.update")(function* (context) {
      const { workflow } = yield* requireWorkflowForUser(context, input.params.id)
      const manifest = yield* readWorkflowManifest(context.env, workflow.manifest_key)
      const setup = yield* getWorkflowSlackAppSetup({
        env: context.env,
        workflow,
        manifest,
        serverUrl: publicServerUrl(context.request),
      })
      const status = yield* storeWorkflowSlackAppCredentials({
        env: context.env,
        workflow,
        app: setup.app,
        signingSecret: input.payload.signingSecret,
        botToken: input.payload.botToken,
      })
      return json({
        slackApp: formatSlackAppSetup({
          ...setup,
          status,
        }),
      })
    }),
  )
}
