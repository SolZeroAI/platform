"use client"

import { getGitHubRepoTool, normalizeSessionTools, type SessionToolSpec } from "@c0-agent/shared"
import { Badge } from "@cloudflare/kumo/components/badge"
import { Banner } from "@cloudflare/kumo/components/banner"
import { Button } from "@cloudflare/kumo/components/button"
import { Empty } from "@cloudflare/kumo/components/empty"
import { Input } from "@cloudflare/kumo/components/input"
import { Link as KumoLink } from "@cloudflare/kumo/components/link"
import { Pagination } from "@cloudflare/kumo/components/pagination"
import { Table as KumoTable } from "@cloudflare/kumo/components/table"
import { Link as RouterLink } from "@tanstack/react-router"
import { Check, FolderGit2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { C0Loader, TableCellState } from "@/components/c0-loader"
import { DialogPaginationPageSize } from "@/components/dialog-pagination-page-size"
import { Dialog } from "@/components/ui/dialog"

const REPO_PAGE_SIZE_OPTIONS = [10, 20, 50] as const

interface Repo {
  id: number
  fullName: string
  owner: string
  name: string
  description: string | null
  private: boolean
}

interface RepoPagination {
  page: number
  perPage: number
  totalCount: number | null
  hasMore: boolean
}

export interface RepoQueryState {
  q: string
  owner: string
  visibility: "all" | "private" | "public"
  sort: "best-match" | "updated"
  order: "desc" | "asc"
  page: number
  perPage: number
}

interface HomeGitRepoDialogProps {
  open: boolean
  onClose: () => void
  repos: Repo[]
  repoQuery?: RepoQueryState
  repoPagination?: RepoPagination | null
  loadingRepos: boolean
  needsGitHubLink?: boolean
  githubAppInstallUrl?: string | null
  selectedTools: SessionToolSpec[]
  onRepoQueryChange?: (patch: Partial<RepoQueryState>) => void
  onSave: (tools: SessionToolSpec[]) => Promise<void> | void
  saveLabel?: string
  saving?: boolean
  error?: string
}

function setSelectedRepo(tools: SessionToolSpec[], repoFullName: string | null): SessionToolSpec[] {
  const withoutRepo = tools.filter((tool) => tool.kind !== "github_repo")
  if (!repoFullName) {
    return normalizeSessionTools(withoutRepo)
  }

  const [repoOwner, repoName] = repoFullName.split("/")
  if (!repoOwner || !repoName) {
    return normalizeSessionTools(withoutRepo)
  }

  return normalizeSessionTools([
    ...withoutRepo,
    {
      kind: "github_repo",
      repoOwner,
      repoName,
    },
  ])
}

const DEFAULT_REPO_QUERY = {
  q: "",
  owner: "all",
  visibility: "all",
  sort: "best-match",
  order: "desc",
  page: 1,
  perPage: 10,
} satisfies RepoQueryState

export function HomeGitRepoDialog({
  open,
  onClose,
  repos,
  repoQuery,
  repoPagination,
  loadingRepos,
  needsGitHubLink = false,
  githubAppInstallUrl,
  selectedTools,
  onRepoQueryChange,
  onSave,
  saveLabel = "Save",
  saving = false,
  error,
}: HomeGitRepoDialogProps) {
  const [draftTools, setDraftTools] = useState<SessionToolSpec[]>(selectedTools)
  const [saveError, setSaveError] = useState("")
  const selectedToolsRef = useRef(selectedTools)
  selectedToolsRef.current = selectedTools
  const selectedRepo = getGitHubRepoTool(draftTools)
  const selectedRepoFullName = selectedRepo
    ? `${selectedRepo.repoOwner}/${selectedRepo.repoName}`
    : ""
  const activeRepoQuery = repoQuery ?? DEFAULT_REPO_QUERY
  const repoCountStart =
    repos.length > 0 ? (activeRepoQuery.page - 1) * activeRepoQuery.perPage + 1 : 0
  const repoCountEnd = repoCountStart > 0 ? repoCountStart + repos.length - 1 : 0
  const paginationTotalCount =
    repoPagination?.totalCount ??
    (repoCountEnd > 0 ? repoCountEnd + (repoPagination?.hasMore ? 1 : 0) : 0)
  const showGitHubLinkEmptyState = needsGitHubLink && !loadingRepos && repos.length === 0

  const selectRepo = (repoFullName: string | null) => {
    setDraftTools(setSelectedRepo(draftTools, repoFullName))
  }

  useEffect(() => {
    if (!open) {
      return
    }

    setDraftTools(selectedToolsRef.current)
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
      <Dialog size="lg" className="flex max-h-[85vh] w-full max-w-2xl flex-col p-0">
        <div className="border-b border-kumo-hairline px-5 py-4">
          <Dialog.Title className="text-lg font-semibold leading-6 text-kumo-default">
            GitHub repository
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm leading-5 text-kumo-subtle">
            Give your agent access and context to a repository
          </Dialog.Description>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          {showGitHubLinkEmptyState ? (
            <div className="rounded-xl bg-kumo-base px-4 py-8 text-center text-sm text-kumo-subtle">
              No GitHub account linked.{" "}
              <RouterLink
                to="/settings"
                search={{ githubSetup: "1" }}
                className="text-kumo-default hover:underline"
              >
                Link GitHub in Settings
              </RouterLink>{" "}
              to enable repo-backed agents.
            </div>
          ) : (
            <>
              {onRepoQueryChange ? (
                <div className="mb-3 w-full">
                  <Input
                    value={activeRepoQuery.q}
                    onChange={(event) => onRepoQueryChange({ q: event.target.value, page: 1 })}
                    placeholder="Search repositories"
                    aria-label="Search repositories"
                    className="w-full"
                    passwordManagerIgnore
                  />
                </div>
              ) : null}

              <div className="overflow-hidden rounded-xl bg-kumo-elevated/80 [container-type:inline-size]">
                <KumoTable className="w-full text-left text-sm">
                  <KumoTable.Header className="bg-kumo-tint text-xs">
                    <KumoTable.Row>
                      <KumoTable.Head className="bg-kumo-tint px-3 py-2 font-medium">
                        Repository
                      </KumoTable.Head>
                      <KumoTable.Head className="bg-kumo-tint px-3 py-2 font-medium">
                        Owner
                      </KumoTable.Head>
                      <KumoTable.Head className="bg-kumo-tint px-3 py-2 font-medium">
                        Visibility
                      </KumoTable.Head>
                      <KumoTable.Head className="w-10 bg-kumo-tint px-3 py-2">
                        <span className="sr-only">Selected</span>
                      </KumoTable.Head>
                    </KumoTable.Row>
                  </KumoTable.Header>
                  <KumoTable.Body>
                    <KumoTable.Row
                      className={`cursor-pointer bg-kumo-base transition hover:bg-kumo-tint ${
                        !selectedRepoFullName ? "bg-kumo-tint/60" : ""
                      }`}
                      onClick={() => selectRepo(null)}
                    >
                      <KumoTable.Cell className="border-b border-kumo-hairline px-3 py-2.5 align-middle">
                        <div className="font-medium text-kumo-default">No repository</div>
                        <div className="text-xs text-kumo-subtle">Chat without a GitHub repo</div>
                      </KumoTable.Cell>
                      <KumoTable.Cell className="border-b border-kumo-hairline px-3 py-2.5 align-middle text-kumo-subtle">
                        —
                      </KumoTable.Cell>
                      <KumoTable.Cell className="border-b border-kumo-hairline px-3 py-2.5 align-middle text-kumo-subtle">
                        —
                      </KumoTable.Cell>
                      <KumoTable.Cell className="border-b border-kumo-hairline px-3 py-2.5 text-center align-middle">
                        {!selectedRepoFullName ? (
                          <Check className="mx-auto h-4 w-4 text-kumo-brand" aria-hidden />
                        ) : null}
                      </KumoTable.Cell>
                    </KumoTable.Row>

                    {loadingRepos ? (
                      <KumoTable.Row className="bg-kumo-base">
                        <KumoTable.Cell
                          colSpan={4}
                          className="border-b border-kumo-hairline px-3 py-8 text-sm text-kumo-subtle"
                        >
                          <TableCellState>
                            <C0Loader size={32} />
                          </TableCellState>
                        </KumoTable.Cell>
                      </KumoTable.Row>
                    ) : repos.length === 0 ? (
                      <KumoTable.Row className="bg-kumo-base">
                        <KumoTable.Cell
                          colSpan={4}
                          className="border-b border-kumo-hairline px-3 py-8 text-sm text-kumo-subtle"
                        >
                          <TableCellState>
                            <Empty
                              title="No repositories found"
                              description="Try a different search, or install c0 on more repositories."
                            />
                          </TableCellState>
                        </KumoTable.Cell>
                      </KumoTable.Row>
                    ) : (
                      repos.map((repo) => {
                        const isSelected = selectedRepoFullName === repo.fullName

                        return (
                          <KumoTable.Row
                            key={repo.id}
                            className={`cursor-pointer bg-kumo-base transition hover:bg-kumo-tint ${
                              isSelected ? "bg-kumo-tint/60" : ""
                            }`}
                            onClick={() => selectRepo(repo.fullName)}
                          >
                            <KumoTable.Cell className="border-b border-kumo-hairline px-3 py-2.5 align-middle">
                              <div className="flex min-w-0 items-center gap-2 font-medium text-kumo-default">
                                <FolderGit2 className="h-4 w-4 flex-shrink-0" aria-hidden />
                                <span className="truncate">{repo.name}</span>
                              </div>
                            </KumoTable.Cell>
                            <KumoTable.Cell className="border-b border-kumo-hairline px-3 py-2.5 align-middle text-kumo-subtle">
                              <span className="truncate">{repo.owner}</span>
                            </KumoTable.Cell>
                            <KumoTable.Cell className="border-b border-kumo-hairline px-3 py-2.5 align-middle">
                              {repo.private ? (
                                <Badge variant="secondary">Private</Badge>
                              ) : (
                                <span className="text-kumo-subtle">Public</span>
                              )}
                            </KumoTable.Cell>
                            <KumoTable.Cell className="border-b border-kumo-hairline px-3 py-2.5 text-center align-middle">
                              {isSelected ? (
                                <Check className="mx-auto h-4 w-4 text-kumo-brand" aria-hidden />
                              ) : null}
                            </KumoTable.Cell>
                          </KumoTable.Row>
                        )
                      })
                    )}
                  </KumoTable.Body>
                </KumoTable>
              </div>

              {onRepoQueryChange ? (
                <Pagination
                  page={activeRepoQuery.page}
                  setPage={(page) => {
                    if (!loadingRepos) {
                      onRepoQueryChange({ page })
                    }
                  }}
                  perPage={activeRepoQuery.perPage}
                  totalCount={paginationTotalCount}
                  className="mt-3 justify-between text-xs"
                >
                  <Pagination.Info />
                  <Pagination.Separator />
                  <DialogPaginationPageSize
                    value={activeRepoQuery.perPage}
                    disabled={loadingRepos}
                    onChange={(size) => {
                      if (!loadingRepos) {
                        onRepoQueryChange({ perPage: size, page: 1 })
                      }
                    }}
                    options={REPO_PAGE_SIZE_OPTIONS}
                  />
                  <Pagination.Controls controls="simple" />
                </Pagination>
              ) : null}

              {githubAppInstallUrl ? (
                <Banner
                  variant="default"
                  className="mt-3"
                  description={
                    <>
                      Don't see your repository?{" "}
                      <KumoLink
                        href={githubAppInstallUrl}
                        target="_blank"
                        rel="noreferrer"
                        variant="current"
                      >
                        Install c0 here
                      </KumoLink>
                    </>
                  }
                />
              ) : null}
            </>
          )}
        </div>

        <div className="border-t border-kumo-hairline px-5 py-4">
          {(saveError || error) && (
            <Banner variant="error" description={saveError || error} className="mb-3" />
          )}

          <div className="flex items-center justify-end gap-2">
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
                    await onSave(draftTools)
                    onClose()
                  } catch (saveErrorValue) {
                    setSaveError(
                      saveErrorValue instanceof Error
                        ? saveErrorValue.message
                        : "Failed to save repository",
                    )
                  }
                }}
              >
                {saving ? "Saving..." : saveLabel}
              </Button>
            </div>
          </div>
        </div>
      </Dialog>
    </Dialog.Root>
  )
}
