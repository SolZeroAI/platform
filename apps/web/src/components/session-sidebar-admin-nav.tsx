import type { AdminRoutePath, AdminView } from "@/lib/admin-console"
import { adminPathForView, adminViewFromPath } from "@/lib/admin-console"

export const ADMIN_SIDEBAR_ITEMS: Array<{ id: AdminView; label: string; to: AdminRoutePath }> = [
  { id: "sessions", label: "Agents", to: adminPathForView("sessions") },
  { id: "workflows", label: "Workflows", to: adminPathForView("workflows") },
  { id: "ai-search", label: "AI Search", to: adminPathForView("ai-search") },
  { id: "integrations", label: "Integrations", to: adminPathForView("integrations") },
]

export function getAdminViewFromLocation(
  pathname: string | undefined,
  search?: { view?: string },
): AdminView {
  return adminViewFromPath(pathname, search)
}
