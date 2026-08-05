import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { build } from "alchemy/Bundle"
import * as Effect from "effect/Effect"
import { AGENT_CONTAINER_EXTERNAL_PACKAGES } from "../../apps/api/infra/resources"

describe.each([
  ["opencode", "opencode.ts", "@ai-sdk/harness-opencode"],
  ["codex", "codex.ts", "@ai-sdk/harness-codex"],
  ["claude-code", "claude-code.ts", "@ai-sdk/harness-claude-code"],
] as const)("%s agent container entrypoint", (runtime, entrypoint, harnessPackage) => {
  it("preserves the server startup side effect in the Alchemy bundle", async () => {
    const outputDirectory = await mkdtemp(resolve(tmpdir(), `s0-${runtime}-container-`))
    try {
      const bundle = await Effect.runPromise(
        build(
          {
            input: resolve("packages/agent-container/src", entrypoint),
            external: [...AGENT_CONTAINER_EXTERNAL_PACKAGES],
            platform: "node",
            resolve: { conditionNames: ["node", "import", "module", "default"] },
            treeshake: true,
          },
          {
            dir: outputDirectory,
            entryFileNames: "index.mjs",
            format: "esm",
          },
        ),
      )
      const entry = bundle.files.find((file) => file.path === "index.mjs")
      const code = typeof entry?.content === "string" ? entry.content : ""

      expect(code).toContain("server.listen")
      expect(code).toContain(`startServer("${runtime}")`)
      expect(code).toContain(`from "${harnessPackage}"`)
    } finally {
      await rm(outputDirectory, { recursive: true })
    }
  })
})
