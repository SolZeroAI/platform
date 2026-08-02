import { getInfraServerUrl } from "@c0-agent/shared"
import * as Effect from "effect/Effect"
import { readWorkflowManifest } from "../../../background/workflows/artifacts"
import { WorkflowLifecycle } from "../../../background/workflows/lifecycle"
import { json, runControlPlane } from "../shared/control-plane"
import { formatWorkflow, lifecycleFailure, requireWorkflowForUser } from "./shared"

export function disableWorkflow({ params }: { params: { id: string } }) {
  return runControlPlane(
    Effect.fn("workflows.disable")(function* (context) {
      const access = yield* requireWorkflowForUser(context, params.id)
      const workflow = yield* new WorkflowLifecycle(context.env)
        .disableWorkflow({ workflow: access.workflow })
        .pipe(Effect.mapError(lifecycleFailure))
      const manifest = yield* readWorkflowManifest(context.env, workflow.manifest_key)
      return json({
        workflow: formatWorkflow(workflow, manifest, getInfraServerUrl(context.env)),
      })
    }),
  )
}

export function enableWorkflow({ params }: { params: { id: string } }) {
  return runControlPlane(
    Effect.fn("workflows.enable")(function* (context) {
      const access = yield* requireWorkflowForUser(context, params.id)
      const workflow = yield* new WorkflowLifecycle(context.env)
        .enableWorkflow({ workflow: access.workflow })
        .pipe(Effect.mapError(lifecycleFailure))
      const manifest = yield* readWorkflowManifest(context.env, workflow.manifest_key)
      return json({
        workflow: formatWorkflow(workflow, manifest, getInfraServerUrl(context.env)),
      })
    }),
  )
}
