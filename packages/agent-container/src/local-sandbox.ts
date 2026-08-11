import { spawn as spawnProcess } from "node:child_process"
import { constants } from "node:fs"
import { access, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, normalize, relative, resolve } from "node:path"
import { Readable } from "node:stream"
import type {
  Experimental_SandboxProcess,
  Experimental_SandboxSession,
} from "@ai-sdk/provider-utils"
import type { HarnessV1NetworkSandboxSession, HarnessV1SandboxProvider } from "@ai-sdk/harness"

export const SANDBOX_ROOT = process.env.SANDBOX_ROOT ?? "/workspace"
export const WORKSPACE_DIRECTORY = "repo"
export const WORKSPACE_ROOT =
  process.env.WORKSPACE_ROOT ?? resolve(SANDBOX_ROOT, WORKSPACE_DIRECTORY)

interface LocalSandboxProviderOptions {
  id: string
  env?: Record<string, string>
  workspaceRoot?: string
  ports?: readonly number[]
}

type SandboxRunOptions = Parameters<Experimental_SandboxSession["run"]>[0]
type SandboxReadTextOptions = Parameters<Experimental_SandboxSession["readTextFile"]>[0]

function mergeEnv(extra: Record<string, string> | undefined): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...extra,
  }
}

function resolvePath(root: string, path: string, defaultDirectory = root): string {
  const absolute = isAbsolute(path) ? normalize(path) : resolve(defaultDirectory, path)
  const pathRelativeToRoot = relative(root, absolute)
  if (pathRelativeToRoot.startsWith("..") || isAbsolute(pathRelativeToRoot)) {
    throw new Error(`Path escapes workspace root: ${path}`)
  }
  return absolute
}

function toWebReadable(stream: NodeJS.ReadableStream | null): ReadableStream<Uint8Array> {
  if (!stream) {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close()
      },
    })
  }
  return Readable.toWeb(stream as Readable) as ReadableStream<Uint8Array>
}

async function readAll(readable: ReadableStream<Uint8Array>): Promise<string> {
  const reader = readable.getReader()
  const decoder = new TextDecoder()
  let output = ""
  for (;;) {
    const next = await reader.read()
    if (next.done) {
      output += decoder.decode()
      return output
    }
    output += decoder.decode(next.value, { stream: true })
  }
}

function lineSlice(
  content: string,
  options: Pick<SandboxReadTextOptions, "startLine" | "endLine">,
) {
  if (options.startLine == null && options.endLine == null) {
    return content
  }
  const lines = content.split(/\r?\n/)
  const start = Math.max(1, options.startLine ?? 1) - 1
  const end = options.endLine == null ? lines.length : Math.max(start + 1, options.endLine)
  return lines.slice(start, end).join("\n")
}

export class LocalNetworkSandboxSession implements HarnessV1NetworkSandboxSession {
  readonly description: string
  readonly defaultWorkingDirectory: string
  readonly ports: readonly number[]

  constructor(
    readonly id: string,
    private readonly filesystemRoot: string,
    defaultWorkingDirectory: string,
    private readonly baseEnv: Record<string, string>,
    ports: readonly number[],
  ) {
    this.defaultWorkingDirectory = defaultWorkingDirectory
    this.ports = ports
    this.description = `Local workspace sandbox rooted at ${defaultWorkingDirectory}.`
  }

  async readFile(options: Parameters<Experimental_SandboxSession["readFile"]>[0]) {
    const path = resolvePath(this.filesystemRoot, options.path, this.defaultWorkingDirectory)
    try {
      await access(path, constants.R_OK)
    } catch {
      return null
    }
    const bytes = await readFile(path)
    return new Blob([bytes]).stream()
  }

  async readBinaryFile(options: Parameters<Experimental_SandboxSession["readBinaryFile"]>[0]) {
    const stream = await this.readFile(options)
    if (stream === null) {
      return null
    }
    const response = new Response(stream)
    return new Uint8Array(await response.arrayBuffer())
  }

  async readTextFile(options: SandboxReadTextOptions) {
    const bytes = await this.readBinaryFile(options)
    if (bytes === null) {
      return null
    }
    const content = new TextDecoder(options.encoding ?? "utf-8").decode(bytes)
    return lineSlice(content, options)
  }

  async writeFile(options: Parameters<Experimental_SandboxSession["writeFile"]>[0]) {
    const response = new Response(options.content)
    await this.writeBinaryFile({
      path: options.path,
      content: new Uint8Array(await response.arrayBuffer()),
      abortSignal: options.abortSignal,
    })
  }

  async writeBinaryFile(options: Parameters<Experimental_SandboxSession["writeBinaryFile"]>[0]) {
    const path = resolvePath(this.filesystemRoot, options.path, this.defaultWorkingDirectory)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, options.content, { signal: options.abortSignal })
  }

  async writeTextFile(options: Parameters<Experimental_SandboxSession["writeTextFile"]>[0]) {
    const path = resolvePath(this.filesystemRoot, options.path, this.defaultWorkingDirectory)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, options.content, {
      encoding: (options.encoding ?? "utf-8") as BufferEncoding,
      signal: options.abortSignal,
    })
  }

  async spawn(options: SandboxRunOptions): Promise<Experimental_SandboxProcess> {
    const cwd = options.workingDirectory
      ? resolvePath(this.filesystemRoot, options.workingDirectory, this.defaultWorkingDirectory)
      : this.defaultWorkingDirectory
    await mkdir(cwd, { recursive: true })
    const child = spawnProcess(options.command, {
      cwd,
      env: mergeEnv({ ...this.baseEnv, ...options.env }),
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
    const abort = () => {
      child.kill("SIGTERM")
    }
    options.abortSignal?.addEventListener("abort", abort, { once: true })
    const wait = new Promise<{ exitCode: number }>((resolveWait, reject) => {
      child.once("error", reject)
      child.once("close", (code) => resolveWait({ exitCode: code ?? 0 }))
    }).finally(() => {
      options.abortSignal?.removeEventListener("abort", abort)
    })
    return {
      pid: child.pid,
      stdout: toWebReadable(child.stdout),
      stderr: toWebReadable(child.stderr),
      wait: () => wait,
      kill: async () => {
        child.kill("SIGTERM")
      },
    }
  }

  async run(options: SandboxRunOptions) {
    const child = await this.spawn(options)
    const [stdout, stderr, result] = await Promise.all([
      readAll(child.stdout),
      readAll(child.stderr),
      child.wait(),
    ])
    return {
      exitCode: result.exitCode,
      stdout,
      stderr,
    }
  }

  async getPortUrl(options: { port: number; protocol?: "http" | "https" | "ws" }) {
    const protocol = options.protocol ?? "http"
    return `${protocol}://127.0.0.1:${options.port}`
  }

  async stop() {}

  async destroy() {}

  async setNetworkPolicy() {}

  async setPorts() {}

  restricted(): Experimental_SandboxSession {
    return this
  }
}

export function createLocalSandboxProvider(
  options: LocalSandboxProviderOptions,
): HarnessV1SandboxProvider {
  const root = options.workspaceRoot ?? SANDBOX_ROOT
  return {
    specificationVersion: "harness-sandbox-v1",
    providerId: "s0-local-container",
    createSession: async () => {
      await mkdir(root, { recursive: true })
      return new LocalNetworkSandboxSession(
        options.id,
        "/",
        root,
        options.env ?? {},
        options.ports ?? [3999],
      )
    },
    resumeSession: async () => {
      await mkdir(root, { recursive: true })
      return new LocalNetworkSandboxSession(
        options.id,
        "/",
        root,
        options.env ?? {},
        options.ports ?? [3999],
      )
    },
  }
}

export async function listWorkspaceFiles(path = ".", root = WORKSPACE_ROOT): Promise<string[]> {
  const dir = resolvePath(root, path)
  const entries = await readdir(dir, { withFileTypes: true })
  return entries.map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name)).sort()
}

export async function readWorkspaceTextFile(path: string, root = WORKSPACE_ROOT) {
  const resolved = resolvePath(root, path)
  try {
    const info = await stat(resolved)
    if (!info.isFile()) {
      return null
    }
    return await readFile(resolved, "utf8")
  } catch {
    return null
  }
}
