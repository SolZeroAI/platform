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

export function createDeploymentMetadata(
  options: CreateDeploymentMetadataOptions,
): DeploymentMetadata {
  // oxlint-disable-next-line effect/avoid-process-env -- CLI callers may omit env; tests pass explicit env.
  const env = options.env ?? process.env
  const packageVersion = normalizePackageVersion(
    options.packageVersion ?? readProductVersion(options.repoRoot),
  )
  const commitSha = getCommitSha(env, options.repoRoot)

  return {
    appVersion: `${formatVersionLabel(packageVersion)}-${commitSha}`,
    commitSha,
    packageVersion,
  }
}
