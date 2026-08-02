"use client"

import { useCallback, useEffect, useState } from "react"
import { SecretsTable } from "@/components/secrets-table"
import {
  getUtf8Size,
  MAX_SECRETS_PER_USER,
  MAX_TOTAL_VALUE_SIZE,
  MAX_VALUE_SIZE,
  validateKey,
} from "@/lib/secrets-validation"
import { SECRETS_SEARCH_DEBOUNCE_MS } from "@/components/secrets-search-filter"
import { showErrorToast, showWarningToast } from "@/lib/toast-manager"

export type SecretRow = {
  id: string
  key: string
  value: string
  tags: string[]
  tagDraft: string
  existing: boolean
}

function createRow(partial?: Partial<SecretRow>): SecretRow {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  return {
    id,
    key: "",
    value: "",
    tags: [],
    tagDraft: "",
    existing: false,
    ...partial,
  }
}

function normalizeTags(tags: readonly string[]): string[] {
  return Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean))).sort()
}

function readSecretsResponse(raw: unknown): { rows: SecretRow[]; tags: string[] } {
  if (!raw || typeof raw !== "object" || !("secrets" in raw)) {
    return { rows: [], tags: [] }
  }
  const secrets = (raw as { secrets?: unknown }).secrets
  if (!Array.isArray(secrets)) {
    console.warn("[secrets-editor] Expected secrets to be an array", {
      receivedType: typeof secrets,
    })
    showWarningToast("Unexpected secrets response", {
      description: `Expected secrets to be a list but received ${typeof secrets}.`,
    })
    return { rows: [], tags: [] }
  }
  const rows: SecretRow[] = []
  for (const secret of secrets) {
    if (!secret || typeof secret !== "object") {
      console.warn("[secrets-editor] Ignoring malformed secrets entry", {
        entryType: typeof secret,
      })
      showWarningToast("Skipped a malformed secret", {
        description: `A secrets entry was ${typeof secret} instead of an object and was ignored.`,
      })
      continue
    }
    const key = (secret as { key?: unknown }).key
    const tags = (secret as { tags?: unknown }).tags
    if (typeof key !== "string" || !Array.isArray(tags)) {
      console.warn("[secrets-editor] Ignoring malformed secrets entry", {
        keyType: typeof key,
        tagsType: Array.isArray(tags) ? "array" : typeof tags,
      })
      showWarningToast("Skipped a malformed secret", {
        description: "A secrets entry was missing a string key or tag list and was ignored.",
      })
      continue
    }
    rows.push(
      createRow({
        key,
        tags: normalizeTags(tags.filter((tag): tag is string => typeof tag === "string")),
        existing: true,
      }),
    )
  }
  const responseTags = (raw as { tags?: unknown }).tags
  const tags = Array.isArray(responseTags)
    ? normalizeTags(responseTags.filter((tag): tag is string => typeof tag === "string"))
    : normalizeTags(rows.flatMap((row) => row.tags))
  return { rows, tags }
}

export function SecretsEditor({
  disabled = false,
  onRegisterAddSecret,
}: {
  disabled?: boolean
  onRegisterAddSecret?: (openCreateDialog: () => void) => void
}) {
  const [rows, setRows] = useState<SecretRow[]>([])
  const [allTags, setAllTags] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [deletingKey, setDeletingKey] = useState<string | null>(null)
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [keySearch, setKeySearch] = useState("")
  const [debouncedKeySearch, setDebouncedKeySearch] = useState("")

  const isSearchDebouncing = keySearch !== debouncedKeySearch
  const hasActiveFilters = debouncedKeySearch.trim().length > 0 || selectedTags.length > 0
  const searchLoading = isSearchDebouncing || (loading && hasActiveFilters)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedKeySearch(keySearch), SECRETS_SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [keySearch])

  const loadSecrets = useCallback(async (q: string, tags: readonly string[]) => {
    setLoading(true)
    setError("")
    setSuccess("")
    try {
      const params = new URLSearchParams()
      const trimmedQ = q.trim()
      if (trimmedQ) {
        params.set("q", trimmedQ)
      }
      if (tags.length > 0) {
        params.set("tags", tags.join(","))
      }
      const response = await fetch(
        params.size > 0 ? `/api/secrets?${params.toString()}` : "/api/secrets",
      )
      const data = (await response.json()) as unknown
      if (!response.ok) {
        const message =
          data && typeof data === "object" && "error" in data
            ? String((data as { error?: unknown }).error)
            : "Failed to load secrets"
        setError(message)
        setRows([])
        setAllTags([])
        return
      }
      const parsed = readSecretsResponse(data)
      setRows(parsed.rows)
      setAllTags(parsed.tags)
    } catch (caught) {
      console.error("[secrets-editor] Failed to load secrets", {
        message: caught instanceof Error ? caught.message : String(caught),
      })
      showErrorToast("Failed to load secrets", {
        description: caught instanceof Error ? caught.message : undefined,
      })
      setError("Failed to load secrets")
      setRows([])
      setAllTags([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSecrets(debouncedKeySearch, selectedTags)
  }, [debouncedKeySearch, loadSecrets, selectedTags])

  const removeRow = (rowId: string) => {
    setRows((current) => current.filter((row) => row.id !== rowId))
  }

  const handleAddSecret = () => {
    const row = createRow()
    setRows((current) => [...current, row])
    return row
  }

  const handleDeleteRow = async (row: SecretRow) => {
    if (!row.existing || !row.key) {
      removeRow(row.id)
      return
    }

    setDeletingKey(row.key)
    setError("")
    setSuccess("")

    try {
      const response = await fetch(`/api/secrets/${encodeURIComponent(row.key)}`, {
        method: "DELETE",
      })
      const data = (await response.json()) as { error?: string }
      if (!response.ok) {
        setError(data?.error || "Failed to delete secret")
        return
      }
      setSuccess(`Deleted ${row.key}`)
      await loadSecrets(debouncedKeySearch, selectedTags)
    } catch {
      setError("Failed to delete secret")
    } finally {
      setDeletingKey(null)
    }
  }

  const handleSave = async (pendingUpdate?: { rowId: string; patch: Partial<SecretRow> }) => {
    setError("")
    setSuccess("")

    const effectiveRows = pendingUpdate
      ? rows.map((row) =>
          row.id === pendingUpdate.rowId ? { ...row, ...pendingUpdate.patch } : row,
        )
      : rows

    const entries = effectiveRows
      .filter((row) => row.value.trim().length > 0 || row.existing)
      .map((row) => ({
        key: row.key,
        value: row.value.trim().length > 0 ? row.value : undefined,
        tags: normalizeTags(row.tags),
        existing: row.existing,
      }))

    if (entries.length === 0) {
      setSuccess("No changes to save")
      return
    }

    const uniqueKeys = new Set<string>()
    let totalSize = 0
    for (const entry of entries) {
      const keyError = validateKey(entry.key)
      if (keyError) {
        setError(keyError)
        return
      }
      if (uniqueKeys.has(entry.key)) {
        setError(`Duplicate key '${entry.key}'`)
        return
      }
      uniqueKeys.add(entry.key)

      if (entry.value !== undefined) {
        const valueSize = getUtf8Size(entry.value)
        if (valueSize > MAX_VALUE_SIZE) {
          setError(`Value for '${entry.key}' exceeds ${MAX_VALUE_SIZE} bytes`)
          return
        }
        totalSize += valueSize
      }
    }

    if (totalSize > MAX_TOTAL_VALUE_SIZE) {
      setError(`Total secret size exceeds ${MAX_TOTAL_VALUE_SIZE} bytes`)
      return
    }

    if (uniqueKeys.size > MAX_SECRETS_PER_USER) {
      setError(`Would exceed ${MAX_SECRETS_PER_USER} secrets limit`)
      return
    }

    setSaving(true)
    try {
      const response = await fetch("/api/secrets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secrets: entries.map(({ key, value, tags }) => ({ key, value, tags })),
        }),
      })
      const data = (await response.json()) as { error?: string }
      if (!response.ok) {
        setError(data?.error || "Failed to update secrets")
        return
      }
      if (pendingUpdate) {
        setRows(effectiveRows)
      }
      setSuccess("Secrets updated")
      await loadSecrets(debouncedKeySearch, selectedTags)
    } catch {
      setError("Failed to update secrets")
    } finally {
      setSaving(false)
    }
  }

  return (
    <SecretsTable
      rows={rows}
      loading={loading}
      saving={saving}
      deletingKey={deletingKey}
      disabled={disabled}
      error={error}
      success={success}
      allTags={allTags}
      selectedTags={selectedTags}
      onSelectedTagsChange={setSelectedTags}
      keySearch={keySearch}
      onKeySearchChange={setKeySearch}
      searchLoading={searchLoading}
      onRemoveRow={removeRow}
      onAddSecret={handleAddSecret}
      onRegisterAddSecret={onRegisterAddSecret}
      onDeleteSecret={handleDeleteRow}
      onSave={handleSave}
    />
  )
}
