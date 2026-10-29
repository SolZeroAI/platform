"use client"

import { GlobalSecretWrite } from "@solzero/api"
import { useCallback, useEffect, useState } from "react"
import { SecretsTable } from "@/components/secrets-table"
import { secretsListQuery } from "@/hooks/use-secrets"
import {
  getUtf8Size,
  MAX_SECRETS_PER_USER,
  MAX_TOTAL_VALUE_SIZE,
  MAX_VALUE_SIZE,
  validateKey,
} from "@/lib/secrets-validation"
import { SECRETS_SEARCH_DEBOUNCE_MS } from "@/components/secrets-search-filter"
import { runApi } from "@/lib/api-client"
import { apiQueryKeys, queryClient } from "@/lib/api-hooks"
import { showErrorToast } from "@/lib/toast-manager"

/** Refreshes every other view of the secrets list after a write. */
function invalidateSecrets() {
  return queryClient.invalidateQueries({ queryKey: apiQueryKeys.secrets })
}

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
  return Array.from(
    new Set(
      tags.flatMap((tag) => {
        const trimmed = tag.trim()

        return trimmed ? [trimmed] : []
      }),
    ),
  ).sort()
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

    const trimmedQ = q.trim()

    try {
      const result = await runApi(
        (client) => client.secrets.list({ query: secretsListQuery(trimmedQ, tags.join(",")) }),
        { fallbackMessage: "Failed to load secrets" },
      )

      setRows(
        result.secrets.map((secret) =>
          createRow({ key: secret.key, tags: normalizeTags(secret.tags), existing: true }),
        ),
      )
      setAllTags(normalizeTags(result.tags))
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Failed to load secrets"
      console.error("[secrets-editor] Failed to load secrets", { message })
      showErrorToast("Failed to load secrets", { description: message })
      setError(message)
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
      await runApi((client) => client.secrets.delete({ params: { key: row.key } }), {
        fallbackMessage: "Failed to delete secret",
      })
      setSuccess(`Deleted ${row.key}`)
      await invalidateSecrets()
      await loadSecrets(debouncedKeySearch, selectedTags)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to delete secret")
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
      await runApi(
        (client) =>
          client.secrets.set({
            payload: {
              // The client encodes the payload, so each entry must be a GlobalSecretWrite instance.
              secrets: entries.map(({ key, value, tags }) =>
                value === undefined
                  ? new GlobalSecretWrite({ key, tags })
                  : new GlobalSecretWrite({ key, value, tags }),
              ),
            },
          }),
        { fallbackMessage: "Failed to update secrets" },
      )

      if (pendingUpdate) {
        setRows(effectiveRows)
      }

      setSuccess("Secrets updated")
      await invalidateSecrets()
      await loadSecrets(debouncedKeySearch, selectedTags)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to update secrets")
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
