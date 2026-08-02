"use client"

import { InputGroup } from "@cloudflare/kumo/components/input-group"
import { Loader } from "@cloudflare/kumo/components/loader"
import { Search } from "lucide-react"
import { SecretTagFilter } from "@/components/secret-selector"
import { recessedInputGroupClassName } from "@/lib/recessed-field"

export const SECRETS_SEARCH_DEBOUNCE_MS = 300

export function SecretsSearchFilter({
  keySearch,
  onKeySearchChange,
  searchLoading = false,
  allTags,
  selectedTags,
  onSelectedTagsChange,
  className = "",
}: {
  keySearch: string
  onKeySearchChange: (value: string) => void
  searchLoading?: boolean
  allTags: readonly string[]
  selectedTags: readonly string[]
  onSelectedTagsChange: (tags: string[]) => void
  className?: string
}) {
  return (
    <div className={`flex flex-col gap-2 ${className}`.trim()}>
      <InputGroup size="sm" className={`w-full ${recessedInputGroupClassName}`}>
        <InputGroup.Addon>
          <Search className="h-3.5 w-3.5" aria-hidden />
        </InputGroup.Addon>
        <InputGroup.Input
          value={keySearch}
          onChange={(event) => onKeySearchChange(event.target.value)}
          placeholder="Search by key"
          aria-label="Search secrets by key"
          passwordManagerIgnore
        />
        {searchLoading ? (
          <InputGroup.Addon align="end">
            <Loader />
          </InputGroup.Addon>
        ) : null}
      </InputGroup>
      <SecretTagFilter tags={allTags} selectedTags={selectedTags} onChange={onSelectedTagsChange} />
    </div>
  )
}
