import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { createDeploymentMetadata } from "infra/deploymentMetadata"

const repoRoot = new URL("../..", import.meta.url).pathname

function readGitShortSha(): string {
  return execFileSync("git", ["rev-parse", "--short=6", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim()
}

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

    expect(productVersion).not.toBe("0.0.0")
    expect(metadata.packageVersion).toBe(productVersion)
    expect(metadata.appVersion).toBe(`v${productVersion}-fedcba`)
  })
})
