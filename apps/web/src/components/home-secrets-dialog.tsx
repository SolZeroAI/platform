"use client"

import { Banner } from "@cloudflare/kumo/components/banner"
import { Button, buttonVariants } from "@cloudflare/kumo/components/button"
import { KumoPortalProvider } from "@cloudflare/kumo/utils"
import { Link } from "@tanstack/react-router"
import { useEffect, useRef, useState } from "react"
import { SECRETS_SEARCH_DEBOUNCE_MS, SecretsSearchFilter } from "@/components/secrets-search-filter"
import { SecretMultiSelect } from "@/components/secret-selector"
import { Dialog } from "@/components/ui/dialog"
import { useSecrets } from "@/hooks/use-secrets"

interface HomeSecretsDialogProps {
  open: boolean
  onClose: () => void
  selectedSecretKeys: string[]
  onSave: (secretKeys: string[]) => Promise<void> | void
  saveLabel?: string
  saving?: boolean
  error?: string
  description?: string
}

export function HomeSecretsDialog({
  open,
  onClose,
  selectedSecretKeys,
  onSave,
  saveLabel = "Save",
  saving = false,
  error,
  description = "Selected secrets are injected as environment variables for this session.",
}: HomeSecretsDialogProps) {
  const [draftSecretKeys, setDraftSecretKeys] = useState<string[]>(selectedSecretKeys)
  const [selectedSecretTags, setSelectedSecretTags] = useState<string[]>([])
  const [keySearch, setKeySearch] = useState("")
  const [debouncedKeySearch, setDebouncedKeySearch] = useState("")
  const [saveError, setSaveError] = useState("")
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null)
  const selectedSecretKeysRef = useRef(selectedSecretKeys)
  selectedSecretKeysRef.current = selectedSecretKeys
  const isSearchDebouncing = keySearch !== debouncedKeySearch
  const hasActiveFilters = debouncedKeySearch.trim().length > 0 || selectedSecretTags.length > 0
  const {
    secrets,
    tags: allTags,
    loading: loadingSecrets,
  } = useSecrets({
    q: debouncedKeySearch,
    tags: selectedSecretTags,
    enabled: open,
  })
  const searchLoading = isSearchDebouncing || (loadingSecrets && hasActiveFilters)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedKeySearch(keySearch), SECRETS_SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [keySearch])

  useEffect(() => {
    if (!open) {
      return
    }

    setDraftSecretKeys(selectedSecretKeysRef.current)
    setSelectedSecretTags([])
    setKeySearch("")
    setDebouncedKeySearch("")
    setSaveError("")
  }, [open])

  useEffect(() => {
    if (!open) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose()
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [onClose, open])

  if (!open) {
    return null
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose()
        }
      }}
    >
      <Dialog className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-visible p-0">
        <div ref={setPortalContainer} className="flex min-h-0 flex-1 flex-col">
          <KumoPortalProvider container={portalContainer}>
            <div className="border-b border-kumo-hairline px-5 py-4">
              <Dialog.Title className="text-lg font-semibold leading-6 text-kumo-default">
                Attach secrets
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm leading-5 text-kumo-subtle">
                {description}
              </Dialog.Description>
            </div>

            <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
              <div className="space-y-3">
                <SecretsSearchFilter
                  keySearch={keySearch}
                  onKeySearchChange={setKeySearch}
                  searchLoading={searchLoading}
                  allTags={allTags}
                  selectedTags={selectedSecretTags}
                  onSelectedTagsChange={setSelectedSecretTags}
                />
                {loadingSecrets && !searchLoading ? (
                  <p className="text-xs text-kumo-subtle">Loading secrets...</p>
                ) : (
                  <SecretMultiSelect
                    secrets={secrets}
                    selectedKeys={draftSecretKeys}
                    onChange={setDraftSecretKeys}
                    emptyMessage={
                      hasActiveFilters
                        ? "No secrets found. Adjust search or tag filters."
                        : "No secrets available."
                    }
                  />
                )}
              </div>
            </div>

            <div className="border-t border-kumo-hairline px-5 py-4">
              {(saveError || error) && (
                <Banner variant="error" description={saveError || error} className="mb-3" />
              )}

              <div className="flex items-center justify-between gap-2">
                <Link
                  to="/settings"
                  search={{ category: "secrets" }}
                  className={buttonVariants({ variant: "ghost" })}
                  onClick={onClose}
                >
                  Manage Secrets
                </Link>
                <div className="flex items-center gap-2">
                  <Button type="button" onClick={onClose} variant="ghost">
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    disabled={saving}
                    loading={saving}
                    variant="primary"
                    className="text-white"
                    onClick={async () => {
                      try {
                        setSaveError("")
                        await onSave(draftSecretKeys)
                        onClose()
                      } catch (saveErrorValue) {
                        setSaveError(
                          saveErrorValue instanceof Error
                            ? saveErrorValue.message
                            : "Failed to save secrets",
                        )
                      }
                    }}
                  >
                    {saving ? "Saving..." : saveLabel}
                  </Button>
                </div>
              </div>
            </div>
          </KumoPortalProvider>
        </div>
      </Dialog>
    </Dialog.Root>
  )
}
