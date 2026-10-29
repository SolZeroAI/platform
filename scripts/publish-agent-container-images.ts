import { spawnSync } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { bundleAgentContainer } from "./agent-container-build"
import {
  AGENT_CONTAINER_ENTRYPOINTS,
  AGENT_CONTAINER_IMAGE_NAMES,
} from "../packages/agent-container/src/images"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const publishedImagesPath = resolve(repoRoot, "packages/agent-container/src/published-images.ts")
const registry = "ghcr.io/solzeroai"

type RuntimeName = keyof typeof AGENT_CONTAINER_ENTRYPOINTS

function isRuntimeName(value: string): value is RuntimeName {
  return Object.hasOwn(AGENT_CONTAINER_ENTRYPOINTS, value)
}

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

function releaseTag(): string {
  const index = process.argv.indexOf("--tag")
  const tag = index === -1 ? undefined : process.argv[index + 1]

  if (!tag?.match(/^v\d+\.\d+\.\d+$/)) {
    throw new Error("Pass the release tag, for example --tag v1.2.3")
  }

  return tag
}

async function publishImage(
  runtime: RuntimeName,
  contextDir: string,
  tag: string,
): Promise<string> {
  const imageName = AGENT_CONTAINER_IMAGE_NAMES[runtime]
  const metadataPath = resolve(tmpdir(), `s0-${runtime}-image-metadata.json`)
  run("docker", [
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
    `${registry}/${imageName}:${tag}`,
    contextDir,
  ])

  // SAFETY: docker buildx --metadata-file writes containerimage.digest as an optional string field.
  const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as {
    "containerimage.digest"?: string
  }

  const digest = metadata["containerimage.digest"]

  if (!digest?.startsWith("sha256:")) {
    throw new Error(`Docker did not report a digest for ${imageName}`)
  }

  return `${registry}/${imageName}@${digest}`
}

async function writePublishedImages(references: Record<RuntimeName, string>): Promise<void> {
  const source = await readFile(publishedImagesPath, "utf8")
  const marker = "> = {}"

  if (!source.includes(marker)) {
    throw new Error(`${publishedImagesPath} no longer ends with an empty image map`)
  }

  await writeFile(
    publishedImagesPath,
    source.replace(marker, `> = ${JSON.stringify(references, null, 2)}`),
  )
}

/**
 * Pushes the agent images for one release and writes their digests into published-images.ts.
 * Release runs this only in the registry job, so the digests ship in the alchemy.new package
 * and never get committed.
 */
async function main(): Promise<void> {
  const tag = releaseTag()
  loginRegistry()
  // SAFETY: the loop assigns a reference for every RuntimeName before references is read.
  const references = {} as Record<RuntimeName, string>

  for (const runtime of Object.keys(AGENT_CONTAINER_ENTRYPOINTS).filter(isRuntimeName)) {
    const contextDir = await mkdtemp(resolve(tmpdir(), `s0-${runtime}-image-`))

    try {
      await bundleAgentContainer(runtime, contextDir)
      references[runtime] = await publishImage(runtime, contextDir, tag)
      console.log(references[runtime])
    } finally {
      await rm(contextDir, { recursive: true, force: true })
    }
  }

  await writePublishedImages(references)
}

await main()
