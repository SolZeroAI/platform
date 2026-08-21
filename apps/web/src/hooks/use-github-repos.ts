"use client"

import { getErrorMessage } from "@solzero/shared"
import { useCallback, useEffect, useState } from "react"
import type { RepoQueryState } from "@/components/home-git-repo-dialog"

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
    const params = new URLSearchParams({
      page: String(activeQuery.page),
      perPage: String(activeQuery.perPage),
    })
    const trimmedQuery = activeQuery.q.trim()
    if (trimmedQuery) {
      params.set("q", trimmedQuery)
    }
    if (activeQuery.owner !== "all") {
      params.set("owner", activeQuery.owner)
    }
    if (activeQuery.visibility !== "all") {
      params.set("visibility", activeQuery.visibility)
    }
    if (activeQuery.sort !== "best-match") {
      params.set("sort", activeQuery.sort)
      params.set("order", activeQuery.order)
    }

    setLoadingRepos(true)
    setRepoLoadError("")
    setNeedsGitHubLink(false)

    try {
      const res = await fetch(`/api/repos?${params.toString()}`)
      const data = (await res.json().catch(() => ({}))) as {
        repos?: GitHubRepo[]
        pagination?: GitHubRepoPagination
        error?: string
        githubAppInstallUrl?: string | null
      }

      if (!res.ok) {
        if (res.status === 403) {
          setNeedsGitHubLink(true)
          setRepos([])
          setRepoPagination(null)
          return
        }
        throw new Error(data.error ?? `Request failed with status ${res.status}`)
      }

      setRepos(Array.isArray(data.repos) ? data.repos : [])
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
