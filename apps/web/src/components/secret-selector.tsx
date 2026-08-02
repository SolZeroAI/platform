"use client"

import { Badge } from "@cloudflare/kumo/components/badge"
import { Combobox } from "@cloudflare/kumo/components/combobox"
import { Tag, X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import type { SecretMetadata } from "@/hooks/use-secrets"
import { recessedComboboxTriggerClassName } from "@/lib/recessed-field"

type SecretTagGroup = {
  value: string
  items: string[]
}

function SecretTagComboboxItem({ tag }: { tag: string }) {
  return (
    <Combobox.Item key={tag} value={tag}>
      <span className="font-mono text-xs">{tag}</span>
    </Combobox.Item>
  )
}

function SelectedSecretTagChip({ tag, onRemove }: { tag: string; onRemove: () => void }) {
  return (
    <span className="inline-flex h-6 items-center gap-2.5 rounded-sm bg-kumo-elevated pl-2 pr-[3px] text-sm ring-1 ring-kumo-hairline">
      <span className="font-mono text-xs">{tag}</span>
      <button
        type="button"
        aria-label={`Remove ${tag}`}
        className="flex cursor-pointer rounded-md bg-transparent p-1 hover:bg-kumo-fill-hover"
        onClick={onRemove}
      >
        <X className="h-2.5 w-2.5" aria-hidden />
      </button>
    </span>
  )
}

export function filterSecretsByTags<T extends SecretMetadata>(
  secrets: readonly T[],
  selectedTags: readonly string[],
): T[] {
  if (selectedTags.length === 0) {
    return [...secrets]
  }
  const selected = new Set(selectedTags)
  return secrets.filter((secret) => secret.tags.some((tag) => selected.has(tag)))
}

export function SecretTagFilter({
  tags,
  selectedTags,
  onChange,
  className = "",
}: {
  tags: readonly string[]
  selectedTags: readonly string[]
  onChange: (tags: string[]) => void
  className?: string
}) {
  const [popularTags, setPopularTags] = useState<string[]>([])
  const [inputValue, setInputValue] = useState("")
  const { contains } = Combobox.useFilter()
  const isSearching = inputValue.trim().length > 0

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch("/api/secrets/tags")
        const data = (await response.json()) as unknown
        if (!response.ok || cancelled) {
          return
        }
        const popular = (data as { popularTags?: unknown }).popularTags
        if (Array.isArray(popular)) {
          setPopularTags(popular.filter((tag): tag is string => typeof tag === "string"))
        }
      } catch {
        // Popular tag suggestions are optional; search still uses the full tag list.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const comboboxItems = useMemo((): string[] | SecretTagGroup[] => {
    if (isSearching) {
      const query = inputValue.trim()
      return tags.filter((tag) => contains(tag, query))
    }
    if (popularTags.length > 0) {
      return [{ value: "Popular tags", items: [...popularTags] }]
    }
    if (tags.length > 0) {
      return [{ value: "All tags", items: [...tags] }]
    }
    return []
  }, [contains, inputValue, isSearching, popularTags, tags])

  return (
    <div className={`secret-tag-filter w-full space-y-1.5 ${className}`.trim()}>
      <Combobox<string, true>
        size="sm"
        multiple
        value={[...selectedTags]}
        onValueChange={(value) => {
          onChange([...value].sort())
          setInputValue("")
        }}
        items={comboboxItems as string[]}
        onInputValueChange={setInputValue}
        filter={null}
      >
        <div className="relative w-full">
          <Tag
            className="pointer-events-none absolute top-1/2 left-2 z-10 h-3.5 w-3.5 -translate-y-1/2 text-kumo-subtle"
            aria-hidden
          />
          <Combobox.TriggerInput
            className={`${recessedComboboxTriggerClassName} [&_input]:pl-7!`}
            placeholder="Filter by tags"
            aria-label="Filter by tags"
          />
        </div>
        {selectedTags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {selectedTags.map((tag) => (
              <SelectedSecretTagChip
                key={tag}
                tag={tag}
                onRemove={() => onChange(selectedTags.filter((selected) => selected !== tag))}
              />
            ))}
          </div>
        ) : null}
        <Combobox.Content className="z-[100]">
          <Combobox.Empty>No tags found.</Combobox.Empty>
          <Combobox.List>
            {isSearching
              ? (tag: string) => <SecretTagComboboxItem tag={tag} />
              : (group: SecretTagGroup) => (
                  <Combobox.Group key={group.value} items={group.items}>
                    <Combobox.GroupLabel>{group.value}</Combobox.GroupLabel>
                    <Combobox.Collection>
                      {(tag: string) => <SecretTagComboboxItem tag={tag} />}
                    </Combobox.Collection>
                  </Combobox.Group>
                )}
          </Combobox.List>
        </Combobox.Content>
      </Combobox>
    </div>
  )
}

export function SecretMultiSelect({
  secrets,
  selectedKeys,
  onChange,
  emptyMessage = "No secrets available.",
}: {
  secrets: readonly SecretMetadata[]
  selectedKeys: readonly string[]
  onChange: (keys: string[]) => void
  emptyMessage?: string
}) {
  const selected = new Set(selectedKeys)
  return (
    <div className="space-y-2">
      {secrets.length === 0 ? (
        <p className="text-xs text-kumo-subtle">{emptyMessage}</p>
      ) : (
        secrets.map((secret) => (
          <label
            key={secret.key}
            className="flex items-center gap-2 rounded-lg border border-kumo-hairline p-2 text-sm text-kumo-default"
          >
            <input
              type="checkbox"
              className="shrink-0"
              checked={selected.has(secret.key)}
              onChange={(event) => {
                const next = new Set(selected)
                if (event.target.checked) {
                  next.add(secret.key)
                } else {
                  next.delete(secret.key)
                }
                onChange(Array.from(next).sort())
              }}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-xs">{secret.key}</span>
              {secret.tags.length > 0 && (
                <span className="mt-1 flex flex-wrap gap-1">
                  {secret.tags.map((tag) => (
                    <Badge key={tag} variant="secondary">
                      {tag}
                    </Badge>
                  ))}
                </span>
              )}
            </span>
          </label>
        ))
      )}
    </div>
  )
}
