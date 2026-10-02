import { spawnSync } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "alchemy/Bundle"
import * as Effect from "effect/Effect"
import {
  AGENT_CONTAINER_ENTRYPOINTS,
  AGENT_CONTAINER_EXTERNAL_PACKAGES,
  AGENT_CONTAINER_IMAGE_NAMES,
  AGENT_CONTAINER_IMAGES,
} from "../packages/agent-container/src/images"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const imagesPath = resolve(repoRoot, "packages/agent-container/src/images.ts")
const dockerfilePath = resolve(repoRoot, "packages/agent-container/Dockerfile")
const registry = "ghcr.io/solzeroai"
type RuntimeName = keyof typeof AGENT_CONTAINER_ENTRYPOINTS

function run(command: string, args: string[], env?: NodeJS.ProcessEnv): string {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  })
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status ?? "signal"})\n${result.stderr || result.stdout}`,
    )
  }
  return result.stdout
}

function ghToken(): string {
  const fromEnv = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
  if (fromEnv) return fromEnv
  return run("gh", ["auth", "token"]).trim()
}

function githubLogin(): string {
  if (process.env.GITHUB_ACTOR) return process.env.GITHUB_ACTOR
  return run("gh", ["api", "user", "--jq", ".login"]).trim()
}

function loginRegistry(): void {
  const token = ghToken()
  const result = spawnSync(
    "docker",
    ["login", "ghcr.io", "--username", githubLogin(), "--password-stdin"],
    {
      input: token,
      encoding: "utf8",
    },
  )
  if (result.status !== 0) {
    throw new Error(`docker login ghcr.io failed\n${result.stderr || result.stdout}`)
  }
}

async function bundleRuntime(runtime: RuntimeName, contextDir: string): Promise<void> {
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

async function publishImage(runtime: RuntimeName, contextDir: string): Promise<string> {
  const imageName = AGENT_CONTAINER_IMAGE_NAMES[runtime]
  const metadataPath = resolve(tmpdir(), `s0-${runtime}-image-metadata.json`)
  run(
    "docker",
    [
      "buildx",
      "build",
      "--platform",
      "linux/amd64",
      "--provenance=false",
      "--sbom=false",
      "--metadata-file",
      metadataPath,
      "--push",
      "--tag",
      `${registry}/${imageName}:release`,
      contextDir,
    ],
    { SOURCE_DATE_EPOCH: "0" },
  )
  const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as {
    "containerimage.digest"?: string
  }
  const digest = metadata["containerimage.digest"]
  if (!digest?.startsWith("sha256:")) {
    throw new Error(`Docker did not report a digest for ${imageName}`)
  }
  return digest
}

function makePackagePublic(imageName: string): void {
  const token = ghToken()
  const result = spawnSync(
    "gh",
    [
      "api",
      "--method",
      "PATCH",
      `/orgs/SolZeroAI/packages/container/${imageName}`,
      "-H",
      "Accept: application/vnd.github+json",
      "--input",
      "-",
    ],
    {
      input: JSON.stringify({ visibility: "public" }),
      encoding: "utf8",
      env: { ...process.env, GH_TOKEN: token },
    },
  )
  if (result.status === 0) return
  const details = result.stderr || result.stdout
  if (details.includes("404")) {
    console.error(
      `GitHub cannot change org package visibility through the API. Make ghcr.io/solzeroai/${imageName} public at https://github.com/orgs/SolZeroAI/packages/container/${imageName}/settings`,
    )
    return
  }
  throw new Error(`Unable to make ghcr.io/solzeroai/${imageName} public\n${details}`)
}

function referenceFor(runtime: RuntimeName, digest: string): string {
  return `${registry}/${AGENT_CONTAINER_IMAGE_NAMES[runtime]}@${digest}`
}

async function writeDigests(digests: Record<RuntimeName, string>): Promise<void> {
  let source = await readFile(imagesPath, "utf8")
  for (const runtime of Object.keys(AGENT_CONTAINER_IMAGES) as RuntimeName[]) {
    const current = AGENT_CONTAINER_IMAGES[runtime]
    const next = referenceFor(runtime, digests[runtime])
    if (!source.includes(current)) {
      throw new Error(`images.ts is missing the ${runtime} reference ${current}`)
    }
    source = source.replace(current, next)
  }
  await writeFile(imagesPath, source)
}

async function main(): Promise<void> {
  const write = process.argv.includes("--write")
  loginRegistry()
  const digests = {} as Record<RuntimeName, string>
  for (const runtime of Object.keys(AGENT_CONTAINER_ENTRYPOINTS) as RuntimeName[]) {
    const contextDir = await mkdtemp(resolve(tmpdir(), `s0-${runtime}-image-`))
    try {
      await bundleRuntime(runtime, contextDir)
      const digest = await publishImage(runtime, contextDir)
      digests[runtime] = digest
      console.log(referenceFor(runtime, digest))
      makePackagePublic(AGENT_CONTAINER_IMAGE_NAMES[runtime])
    } finally {
      await rm(contextDir, { recursive: true, force: true })
    }
  }

  const mismatches = (Object.keys(digests) as RuntimeName[]).filter(
    (runtime) => AGENT_CONTAINER_IMAGES[runtime] !== referenceFor(runtime, digests[runtime]),
  )
  if (write) {
    await writeDigests(digests)
    return
  }
  if (mismatches.length > 0) {
    throw new Error(
      `Image digests differ from packages/agent-container/src/images.ts: ${mismatches.join(", ")}. Run with --write and commit the digest.`,
    )
  }
}

await main()
