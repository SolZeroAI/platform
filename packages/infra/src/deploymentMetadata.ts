import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const UNKNOWN_COMMIT_SHA = "unknown"

export interface DeploymentMetadata {
  readonly appVersion: string
  readonly commitSha: string
  readonly packageVersion: string
}

export interface CreateDeploymentMetadataOptions {
  readonly env?: NodeJS.ProcessEnv
  readonly packageVersion?: string
  readonly repoRoot: string
}

function normalizePackageVersion(version: string): string {
  const trimmed = version.trim()
  return trimmed.startsWith("v") ? trimmed.slice(1) : trimmed
}

function formatVersionLabel(version: string): string {
  return `v${normalizePackageVersion(version)}`
}

function shortenCommitSha(commitSha: string | undefined): string | undefined {
  const trimmed = commitSha?.trim()
  if (!trimmed) {
    return undefined
  }

  return trimmed.slice(0, 6)
}

function readLocalCommitSha(repoRoot: string): string | undefined {
  const result = spawnSync("git", ["rev-parse", "--short=6", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  })
  if (result.status !== 0 || result.error) {
    return undefined
  }
  return result.stdout.trim() || undefined
}

function getCommitSha(env: NodeJS.ProcessEnv, repoRoot: string): string {
  return (
    shortenCommitSha(env.GITHUB_SHA) ??
    shortenCommitSha(env.COMMIT_SHA) ??
    shortenCommitSha(readLocalCommitSha(repoRoot)) ??
    UNKNOWN_COMMIT_SHA
  )
}

/**
 * The public product version lives in the repo-root VERSION file. Workspace
 * package.json versions stay at 0.0.0 and never describe the release.
 */
function readProductVersion(repoRoot: string): string {
  return readFileSync(resolve(repoRoot, "VERSION"), "utf8")
}

/**
 * Commits between the release tag for the product version and the deployed
 * commit. Returns undefined when the tag or history is unavailable, for
 * example in a shallow checkout or before the release workflow pushes the tag.
 */
function countCommitsSinceRelease(repoRoot: string, version: string): number | undefined {
  const result = spawnSync("git", ["rev-list", "--count", `v${version}..HEAD`], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  })
  if (result.status !== 0 || result.error) {
    return undefined
  }
  const count = Number.parseInt(result.stdout.trim(), 10)
  if (Number.isNaN(count)) {
    return undefined
  }
  return count
}

/**
 * SemVer build-metadata suffix marking unreleased commits, so a preview build
 * past the release tag reads `v1.5.0+2-bbb222` instead of `v1.5.0-bbb222`.
 */
function releaseOffsetLabel(repoRoot: string, version: string): string {
  const commitsSinceRelease = countCommitsSinceRelease(repoRoot, version)
  if (commitsSinceRelease === undefined || commitsSinceRelease === 0) {
    return ""
  }
  return `+${commitsSinceRelease}`
}

export function createDeploymentMetadata(
  options: CreateDeploymentMetadataOptions,
): DeploymentMetadata {
  // oxlint-disable-next-line effect/avoid-process-env -- CLI callers may omit env; tests pass explicit env.
  const env = options.env ?? process.env
  const packageVersion = normalizePackageVersion(
    options.packageVersion ?? readProductVersion(options.repoRoot),
  )
  const commitSha = getCommitSha(env, options.repoRoot)
  const releaseOffset = releaseOffsetLabel(options.repoRoot, packageVersion)

  return {
    appVersion: `${formatVersionLabel(packageVersion)}${releaseOffset}-${commitSha}`,
    commitSha,
    packageVersion,
  }
}
