import "@xyflow/react/dist/style.css"

import { createFileRoute } from "@tanstack/react-router"
import { WorkflowsIndexPage } from "@/components/workflows/index-page"
import { loadWorkflowsRouteData } from "@/components/workflows/route-data"
import { getRouteWorkflowId } from "@/components/workflows/types"
import { loadWhenSignedIn, RouteLoadError, RoutePending } from "@/lib/route-loaders"

export const Route = createFileRoute("/_authenticated/workflows")({
  ssr: false,
  // The page keeps the list and the open workflow in its own state after it opens, so load only
  // when the workflows section opens, and drop the data when it closes.
  shouldReload: false,
  gcTime: 0,
  loader: ({ location, ...context }) =>
    loadWhenSignedIn(context, (signal) =>
      loadWorkflowsRouteData(getRouteWorkflowId(location.pathname), signal),
    ),
  pendingComponent: RoutePending,
  errorComponent: RouteLoadError,
  component: WorkflowsRoute,
})

function WorkflowsRoute() {
  const data = Route.useLoaderData()

  return data ? <WorkflowsIndexPage initialData={data} /> : <RoutePending />
}
