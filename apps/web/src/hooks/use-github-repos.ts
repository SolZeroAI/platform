"use client"

import type { EnrichedRepositorySummary, ReposListQuery, ReposListResponse } from "@solzero/api"
import { getErrorMessage } from "@solzero/shared"
import { useCallback, useEffect, useState } from "react"
import type { RepoQueryState } from "@/components/home-git-repo-dialog"
import { hasApiErrorTag, runApi } from "@/lib/api-client"

export interface GitHubRepo {
  id: number
  fullName: string
  owner: string
  name: string
  description: string | null
  private: boolean
}

export interface GitHubRepoPagination {
  page: number
  perPage: number
  totalCount: number | null
  hasMore: boolean
}

export const INITIAL_GITHUB_REPO_QUERY: RepoQueryState = {
  q: "",
  owner: "all",
  visibility: "all",
  sort: "best-match",
  order: "desc",
  page: 1,
  perPage: 10,
}

/** The repository page for `query`, or `null` when the user has not authorized the GitHub App. */
export async function fetchGitHubRepos(query: RepoQueryState): Promise<ReposListResponse | null> {
  const params: ReposListQuery = { page: String(query.page), perPage: String(query.perPage) }
  const q = query.q.trim()

  if (q) params.q = q

  if (query.owner !== "all") params.owner = query.owner

  if (query.visibility !== "all") params.visibility = query.visibility

  if (query.sort !== "best-match") {
    params.sort = query.sort
    params.order = query.order
  }

  try {
    return await runApi((client) => client.repos.list({ query: params }))
  } catch (caught) {
    if (hasApiErrorTag(caught, "ForbiddenError")) return null

    throw caught
  }
}

/** Copies decoded repositories into the mutable shape that repository pickers keep in state. */
export function toGitHubRepos(repos: ReadonlyArray<EnrichedRepositorySummary>): GitHubRepo[] {
  return repos.map(({ id, fullName, owner, name, description, private: isPrivate }) => ({
    id,
    fullName,
    owner,
    name,
    description,
    private: isPrivate,
  }))
}

export function useGitHubRepos(options: { enabled?: boolean } = {}) {
  const enabled = options.enabled ?? true
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [loadingRepos, setLoadingRepos] = useState(false)
  const [repoLoadError, setRepoLoadError] = useState("")
  const [needsGitHubLink, setNeedsGitHubLink] = useState(false)
  const [githubAppInstallUrl, setGithubAppInstallUrl] = useState<string | null>(null)
  const [repoQuery, setRepoQuery] = useState<RepoQueryState>(INITIAL_GITHUB_REPO_QUERY)
  const [repoPagination, setRepoPagination] = useState<GitHubRepoPagination | null>(null)

  const fetchRepos = useCallback(async (activeQuery: RepoQueryState) => {
    setLoadingRepos(true)
    setRepoLoadError("")
    setNeedsGitHubLink(false)

    try {
      const data = await fetchGitHubRepos(activeQuery)

      if (data === null) {
        setNeedsGitHubLink(true)
        setRepos([])
        setRepoPagination(null)

        return
      }

      setRepos(toGitHubRepos(data.repos))
      setRepoPagination(data.pagination ?? null)
      setGithubAppInstallUrl(data.githubAppInstallUrl ?? null)
    } catch (errorValue) {
      setRepoLoadError(getErrorMessage(errorValue, "Request failed"))
    } finally {
      setLoadingRepos(false)
    }
  }, [])

  useEffect(() => {
    if (!enabled) {
      return
    }

    const timeoutId = setTimeout(() => {
      void fetchRepos(repoQuery)
    }, 250)

    return () => clearTimeout(timeoutId)
  }, [enabled, repoQuery, fetchRepos])

  const updateRepoQuery = useCallback((patch: Partial<RepoQueryState>) => {
    setRepoQuery((current) => ({
      ...current,
      ...patch,
      page: patch.page ?? current.page,
    }))
  }, [])

  return {
    repos,
    loadingRepos,
    repoLoadError,
    needsGitHubLink,
    githubAppInstallUrl,
    repoQuery,
    repoPagination,
    updateRepoQuery,
  }
}
