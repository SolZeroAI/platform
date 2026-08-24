import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { createDeploymentMetadata } from "infra/deploymentMetadata"

const repoRoot = new URL("../..", import.meta.url).pathname

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.email=test@example.com", "-c", "user.name=Test", ...args],
    { cwd, encoding: "utf8" },
  ).trim()
}

function readGitShortSha(cwd: string = repoRoot): string {
  return git(cwd, "rev-parse", "--short=6", "HEAD")
}

function commitsSinceTag(tag: string): number | undefined {
  try {
    return Number.parseInt(git(repoRoot, "rev-list", "--count", `${tag}..HEAD`), 10)
  } catch {
    return undefined
  }
}

const tempRepos: string[] = []

function createTaggedRepo(options: { tag: string; commitsAfterTag: number }): string {
  const dir = mkdtempSync(join(tmpdir(), "s0-deployment-metadata-"))
  tempRepos.push(dir)
  git(dir, "init")
  writeFileSync(join(dir, "file.txt"), "release")
  git(dir, "add", "file.txt")
  git(dir, "commit", "--message", "release commit")
  git(dir, "tag", options.tag)
  for (let index = 0; index < options.commitsAfterTag; index++) {
    writeFileSync(join(dir, "file.txt"), `change ${index}`)
    git(dir, "commit", "--all", "--message", `change ${index}`)
  }
  return dir
}

afterAll(() => {
  for (const dir of tempRepos) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe("createDeploymentMetadata", () => {
  it("formats the package version with a v prefix and 6-character commit suffix", () => {
    const metadata = createDeploymentMetadata({
      env: { GITHUB_SHA: "036d0b1234567890" },
      packageVersion: "1.2.3",
      repoRoot,
    })

    expect(metadata).toEqual({
      appVersion: "v1.2.3-036d0b",
      commitSha: "036d0b",
      packageVersion: "1.2.3",
    })
  })

  it("normalizes package versions that already include a v prefix", () => {
    const metadata = createDeploymentMetadata({
      env: { GITHUB_SHA: "abcdef9876543210" },
      packageVersion: "v2.3.4",
      repoRoot,
    })

    expect(metadata.appVersion).toBe("v2.3.4-abcdef")
    expect(metadata.packageVersion).toBe("2.3.4")
  })

  it("uses COMMIT_SHA when GITHUB_SHA is not set", () => {
    const metadata = createDeploymentMetadata({
      env: { COMMIT_SHA: "123456abcdef" },
      packageVersion: "3.4.5",
      repoRoot,
    })

    expect(metadata.appVersion).toBe("v3.4.5-123456")
    expect(metadata.commitSha).toBe("123456")
  })

  it("falls back to the local git commit", () => {
    const metadata = createDeploymentMetadata({
      env: {},
      packageVersion: "4.5.6",
      repoRoot,
    })

    expect(metadata.appVersion).toBe(`v4.5.6-${readGitShortSha()}`)
    expect(metadata.commitSha).toBe(readGitShortSha())
  })

  it("reads the product version from the VERSION file by default", () => {
    const productVersion = readFileSync(resolve(repoRoot, "VERSION"), "utf8").trim()
    const metadata = createDeploymentMetadata({
      env: { GITHUB_SHA: "fedcba0123456789" },
      repoRoot,
    })

    const commitCount = commitsSinceTag(`v${productVersion}`)
    let expectedOffset = ""
    if (commitCount !== undefined && commitCount > 0) {
      expectedOffset = `+${commitCount}`
    }

    expect(productVersion).not.toBe("0.0.0")
    expect(metadata.packageVersion).toBe(productVersion)
    expect(metadata.appVersion).toBe(`v${productVersion}${expectedOffset}-fedcba`)
  })

  it("omits the release offset on the release commit itself", () => {
    const releaseRepo = createTaggedRepo({ tag: "v9.9.9", commitsAfterTag: 0 })
    const metadata = createDeploymentMetadata({
      env: {},
      packageVersion: "9.9.9",
      repoRoot: releaseRepo,
    })

    expect(metadata.appVersion).toBe(`v9.9.9-${readGitShortSha(releaseRepo)}`)
  })

  it("appends the unreleased commit count after the release tag", () => {
    const aheadRepo = createTaggedRepo({ tag: "v9.9.9", commitsAfterTag: 2 })
    const metadata = createDeploymentMetadata({
      env: {},
      packageVersion: "9.9.9",
      repoRoot: aheadRepo,
    })

    expect(metadata.appVersion).toBe(`v9.9.9+2-${readGitShortSha(aheadRepo)}`)
  })

  it("omits the release offset when the release tag is unavailable", () => {
    const untaggedRepo = createTaggedRepo({ tag: "v0.0.1", commitsAfterTag: 1 })
    const metadata = createDeploymentMetadata({
      env: {},
      packageVersion: "9.9.9",
      repoRoot: untaggedRepo,
    })

    expect(metadata.appVersion).toBe(`v9.9.9-${readGitShortSha(untaggedRepo)}`)
  })
})
