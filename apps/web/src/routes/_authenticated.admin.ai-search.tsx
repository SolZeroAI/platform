import { createFileRoute, redirect } from "@tanstack/react-router"
import { AdminPage } from "@/components/admin-page/page"
import { canonicalAdminSearchForView, isCanonicalAdminSearch } from "@/lib/admin-console"
import { loadAdminAiSearchForRoute } from "@/lib/admin-console.functions"

export const Route = createFileRoute("/_authenticated/admin/ai-search")({
  beforeLoad: ({ search }) => {
    const canonicalSearch = canonicalAdminSearchForView("ai-search", search)
    if (isCanonicalAdminSearch(search, canonicalSearch)) {
      return
    }

    throw redirect({
      to: "/admin/ai-search",
      search: canonicalSearch,
    })
  },
  loader: loadAdminAiSearchForRoute,
  component: AdminAiSearchRoutePage,
})

function AdminAiSearchRoutePage() {
  const search = Route.useSearch()
  const initialAdminAiSearch = Route.useLoaderData()
  return <AdminPage initialAdminAiSearch={initialAdminAiSearch} search={search} view="ai-search" />
}
