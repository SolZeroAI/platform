import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { c0RuleNames } from "../src/index"

const packageRoot = process.cwd()
const repoRoot = resolve(packageRoot, "../..")
const pluginPath = resolve(packageRoot, "src/index.ts")
const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true })
  }
})

describe("oxlint plugin integration", () => {
  it("loads C0 lint rules as error rules", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "c0-lint-integration-"))
    tempDirs.push(tempDir)

    const sourcePath = join(tempDir, "fixture.ts")
    const configPath = join(tempDir, ".oxlintrc.json")
    const relativePluginPath = relative(tempDir, pluginPath)
    const pluginSpecifier = relativePluginPath.startsWith(".")
      ? relativePluginPath
      : `./${relativePluginPath}`

    writeFileSync(
      sourcePath,
      `import { Effect } from "effect";
export const value = Effect.as(Effect.succeed(1), 2);
`,
    )
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          plugins: [],
          jsPlugins: [{ name: "c0-lint", specifier: pluginSpecifier }],
          rules: Object.fromEntries(
            c0RuleNames.map((ruleName) => [`c0-lint/${ruleName}`, "error"]),
          ),
        },
        null,
        2,
      ),
    )

    let output = ""
    let status = "passed"
    try {
      output = execFileSync(
        "nub",
        ["exec", "oxlint", "--config", configPath, sourcePath, "--format", "unix"],
        {
          cwd: repoRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        },
      )
    } catch (error) {
      const failed = error as { stderr?: Buffer | string; stdout?: Buffer | string }
      output = `${failed.stdout?.toString() ?? ""}${failed.stderr?.toString() ?? ""}`
      status = "failed"
    }

    expect(status).toBe("failed")
    expect(output).toContain("c0-lint(no-effect-as)")
    expect(output).toContain("[Error/c0-lint(no-effect-as)]")
  })
})
