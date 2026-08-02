import { getInfraServerUrl } from "@c0-agent/shared"
import * as Effect from "effect/Effect"
import { readWorkflowManifest } from "../../../background/workflows/artifacts"
import { json, runControlPlane } from "../shared/control-plane"
import { formatWorkflow, requireWorkflowForUser } from "./shared"

export function get({ params }: { params: { id: string } }) {
  return runControlPlane(
    Effect.fn("workflows.get")(function* (context) {
      const { workflow } = yield* requireWorkflowForUser(context, params.id)
      const manifest = yield* readWorkflowManifest(context.env, workflow.manifest_key)
      return json({
        workflow: formatWorkflow(workflow, manifest, getInfraServerUrl(context.env)),
      })
    }),
  )
}
