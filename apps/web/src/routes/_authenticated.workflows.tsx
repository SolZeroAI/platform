import "@xyflow/react/dist/style.css"

import { createFileRoute } from "@tanstack/react-router"
import { WorkflowsIndexPage } from "@/components/workflows/index-page"

export const Route = createFileRoute("/_authenticated/workflows")({
  component: WorkflowsIndexPage,
})
