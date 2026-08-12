import { execFile } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { tegami } from "tegami"
import { git } from "tegami/plugins/git"
import { afterEach, describe, expect, it } from "vitest"
import {
  SOLZERO_PACKAGE_ID,
  SOLZERO_VERSION_FILE,
  solZeroRelease,
} from "../../scripts/releases/solzero-release"

const execFileAsync = promisify(execFile)
const fixtureDirectories: string[] = []

async function createFixture(version = "0.0.0"): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "solzero-release-"))
  fixtureDirectories.push(cwd)
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({ name: "release-fixture", version: "0.0.0", private: true }),
  )
  await writeFile(join(cwd, SOLZERO_VERSION_FILE), `${version}\n`)
  await execFileAsync("git", ["init", "--initial-branch=master"], { cwd })
  await execFileAsync("git", ["config", "user.name", "Release Test"], { cwd })
  await execFileAsync("git", ["config", "user.email", "release-test@example.com"], { cwd })
  await execFileAsync("git", ["add", "."], { cwd })
  await execFileAsync("git", ["commit", "--message", "Initial fixture"], { cwd })
  return cwd
}

function createRelease(cwd: string) {
  return tegami({
    cwd,
    ignore: [/^npm:/],
    npm: { client: "nub", updateLockFile: false },
    plugins: [git({ pushTags: false }), solZeroRelease()],
  })
}

afterEach(async () => {
  await Promise.all(
    fixtureDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  )
})

describe("SolZero release provider", () => {
  it("versions the product and publishes one idempotent release tag", async () => {
    const cwd = await createFixture()
    const changelogDirectory = join(cwd, ".tegami")
    await mkdir(changelogDirectory)
    await writeFile(
      join(changelogDirectory, "feature.md"),
      [
        "---",
        "packages:",
        `  "${SOLZERO_PACKAGE_ID}": minor`,
        "---",
        "",
        "## Add durable sessions",
        "",
        "SolZero can preserve sessions across restarts.",
        "",
      ].join("\n"),
    )

    const release = createRelease(cwd)
    const context = await release._internal.context()
    expect(context.graph.getPackages().map((pkg) => pkg.id)).toEqual([SOLZERO_PACKAGE_ID])

    const draft = await release.draft()
    await draft.apply()

    expect(await readFile(join(cwd, SOLZERO_VERSION_FILE), "utf8")).toBe("0.1.0\n")
    expect(await readFile(join(cwd, "CHANGELOG.md"), "utf8")).toContain("Add durable sessions")

    await execFileAsync("git", ["add", "."], { cwd })
    await execFileAsync("git", ["commit", "--message", "Version SolZero"], { cwd })

    const plan = await release.publish()
    expect(plan).not.toBe("skipped")
    if (plan !== "skipped") {
      expect(plan.packages.get(SOLZERO_PACKAGE_ID)?.git?.tag).toBe("v0.1.0")
      expect(plan.packages.get(SOLZERO_PACKAGE_ID)?.publishResult).toEqual({ type: "published" })
    }
    expect((await execFileAsync("git", ["tag", "--list"], { cwd })).stdout.trim()).toBe("v0.1.0")
    await expect(release.publish()).resolves.toBe("skipped")
  })

  it("rejects a non-SemVer product version", async () => {
    const cwd = await createFixture("next")
    await expect(createRelease(cwd)._internal.context()).rejects.toThrow(
      `${SOLZERO_VERSION_FILE} must contain one valid SemVer version.`,
    )
  })
})
