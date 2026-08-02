import { createFileRoute, useLocation } from "@tanstack/react-router"
import { WorkflowsPage } from "@/components/workflows/page"

export const Route = createFileRoute("/_authenticated/workflows/$workflowId")({
  component: WorkflowDetailPage,
})

function WorkflowDetailPage() {
  const { workflowId } = Route.useParams()
  const { pathname } = useLocation()
  return <WorkflowsPage pathname={pathname} routeWorkflowId={workflowId} />
}
