import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "alchemy/Bundle"
import * as Effect from "effect/Effect"
import {
  AGENT_CONTAINER_ENTRYPOINTS,
  AGENT_CONTAINER_EXTERNAL_PACKAGES,
} from "../packages/agent-container/src/images"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const dockerfilePath = resolve(repoRoot, "packages/agent-container/Dockerfile")

type RuntimeName = keyof typeof AGENT_CONTAINER_ENTRYPOINTS

/**
 * Bundles the runtime into a stable build context under `.alchemy/`. Alchemy hashes this context,
 * so a deploy rebuilds the image only when the bundle, the Dockerfile, or the patch changes.
 */
export async function prepareAgentContainerContext(runtime: RuntimeName): Promise<string> {
  const contextDir = resolve(repoRoot, ".alchemy/agent-containers", runtime)
  await rm(contextDir, { recursive: true, force: true })
  await mkdir(contextDir, { recursive: true })
  await bundleAgentContainer(runtime, contextDir)

  return contextDir
}

export async function bundleAgentContainer(
  runtime: RuntimeName,
  contextDir: string,
): Promise<void> {
  const bundle = await Effect.runPromise(
    build(
      {
        input: resolve(
          repoRoot,
          "packages/agent-container/src",
          AGENT_CONTAINER_ENTRYPOINTS[runtime],
        ),
        external: [...AGENT_CONTAINER_EXTERNAL_PACKAGES],
        platform: "node",
        resolve: { conditionNames: ["node", "import", "module", "default"] },
        treeshake: true,
      },
      {
        dir: contextDir,
        entryFileNames: "index.mjs",
        format: "esm",
      },
    ),
  )

  const codexPatch = await readFile(
    resolve(repoRoot, "patches/@ai-sdk+harness-codex@1.0.43.patch"),
    "utf8",
  )

  await writeFile(resolve(contextDir, "harness-codex.patch"), codexPatch)
  const dockerfile = await readFile(dockerfilePath, "utf8")
  await writeFile(resolve(contextDir, "Dockerfile"), dockerfile)
  let wroteJavaScript = false

  for (const file of bundle.files) {
    const name = file.path === "index.mjs" ? "index.mjs" : file.path

    if (name.endsWith(".js")) wroteJavaScript = true
    const content = typeof file.content === "string" ? file.content : Buffer.from(file.content)
    await writeFile(resolve(contextDir, name), content)
  }

  if (!wroteJavaScript) {
    await writeFile(resolve(contextDir, "container-chunks.js"), "export {}\n")
  }
}
