import { createFileRoute } from "@tanstack/react-router"
import {
  parseOktaReconnectStatus,
  type OktaReconnectStatus,
} from "@/components/settings/okta-reconnect"
import { SessionPage } from "@/components/session-page/page"

type SessionRouteSearch = {
  boot?: "1"
  tools?: "step-limit"
  oktaReconnect?: OktaReconnectStatus
  resumeMessageId?: string
  error?: string
  error_description?: string
}

export const Route = createFileRoute("/_authenticated/session/$id")({
  validateSearch: (search): SessionRouteSearch => {
    const oktaReconnect = parseOktaReconnectStatus(search.oktaReconnect)
    const routeSearch: SessionRouteSearch = {}

    if (search.boot === "1") {
      routeSearch.boot = "1"
    }

    if (search.tools === "step-limit") {
      routeSearch.tools = "step-limit"
    }

    if (oktaReconnect) {
      routeSearch.oktaReconnect = oktaReconnect
    }

    if (typeof search.resumeMessageId === "string") {
      routeSearch.resumeMessageId = search.resumeMessageId
    }

    if (typeof search.error === "string") {
      routeSearch.error = search.error
    }

    if (typeof search.error_description === "string") {
      routeSearch.error_description = search.error_description
    }

    return routeSearch
  },
  component: SessionRoutePage,
})

function SessionRoutePage() {
  const { id: sessionId } = Route.useParams()
  const search = Route.useSearch()

  return <SessionPage search={search} sessionId={sessionId} />
}
