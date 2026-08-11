import { serializeWorkflowExport } from "@solzero/shared"
import * as Effect from "effect/Effect"
import { readWorkflowManifest } from "../../../background/workflows/artifacts"
import { runControlPlane } from "../shared/control-plane"
import { requireWorkflowForUser } from "./shared"

export function exportWorkflow({ params }: { params: { id: string } }) {
  return runControlPlane(
    Effect.fn("workflows.export")(function* (context) {
      const { workflow } = yield* requireWorkflowForUser(context, params.id)
      const manifest = yield* readWorkflowManifest(context.env, workflow.manifest_key)
      const yaml = serializeWorkflowExport({
        manifest,
        sourceManifestVersion: workflow.manifest_version,
      })
      return new Response(yaml, {
        headers: {
          "Content-Type": "text/yaml; charset=utf-8",
          "Content-Disposition": `attachment; filename="${params.id}.workflow.yaml"`,
        },
      })
    }),
  )
}
