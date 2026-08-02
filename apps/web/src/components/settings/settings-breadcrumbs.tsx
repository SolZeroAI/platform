"use client"

import { Breadcrumbs } from "@cloudflare/kumo/components/breadcrumbs"
import { getSettingsCategoryLabel, type SettingsCategory } from "@/components/settings/settings-nav"

export function SettingsBreadcrumbs({ category }: { category: SettingsCategory }) {
  return (
    <Breadcrumbs size="sm">
      <Breadcrumbs.Link href="/settings">Settings</Breadcrumbs.Link>
      <Breadcrumbs.Separator />
      <Breadcrumbs.Current>{getSettingsCategoryLabel(category)}</Breadcrumbs.Current>
    </Breadcrumbs>
  )
}
