import { createFileRoute, redirect } from "@tanstack/react-router"
import { AdminPage } from "@/components/admin-page/page"
import { canonicalAdminSearchForView, isCanonicalAdminSearch } from "@/lib/admin-console"
import { loadAdminIntegrationsForRoute } from "@/lib/admin-console.functions"

export const Route = createFileRoute("/_authenticated/admin/integrations")({
  beforeLoad: ({ search }) => {
    const canonicalSearch = canonicalAdminSearchForView("integrations", search)
    if (isCanonicalAdminSearch(search, canonicalSearch)) {
      return
    }

    throw redirect({
      to: "/admin/integrations",
      search: canonicalSearch,
    })
  },
  loader: loadAdminIntegrationsForRoute,
  component: AdminIntegrationsRoutePage,
})

function AdminIntegrationsRoutePage() {
  const search = Route.useSearch()
  const initialAdminIntegrations = Route.useLoaderData()
  return (
    <AdminPage
      initialAdminIntegrations={initialAdminIntegrations}
      search={search}
      view="integrations"
    />
  )
}
