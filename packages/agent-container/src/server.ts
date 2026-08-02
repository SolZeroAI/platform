import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import * as Effect from "effect/Effect"
import { initializeWorkspace } from "./workspace"
import { listWorkspaceFiles, readWorkspaceTextFile } from "./local-sandbox"
import { createCodingAgentRuntime } from "./harness-runtime"
import type {
  HarnessRuntimeName,
  RuntimeInitRequest,
  RuntimeSendRequest,
  RuntimeSendResponse,
} from "./types"

interface ServerState {
  init: RuntimeInitRequest | null
  running: Promise<void> | null
}

const logRequestFailure = Effect.fn("agentContainer.server.logRequestFailure")(
  (error: unknown, context: { method: string; path: string; runtimeKind: HarnessRuntimeName }) =>
    Effect.logError(error).pipe(
      Effect.annotateLogs({
        event: "agent_container.request_failed",
        ...context,
      }),
    ),
)

function jsonResponse(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" })
  response.end(JSON.stringify(body))
}

function textResponse(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" })
  response.end(body)
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  const text = Buffer.concat(chunks).toString("utf8")
  return JSON.parse(text || "{}") as T
}

function mergeSendWithInit(input: RuntimeSendRequest, init: RuntimeInitRequest | null) {
  const repository =
    init?.repoOwner && init.repoName
      ? {
          owner: init.repoOwner,
          name: init.repoName,
          defaultBranch: init.repoDefaultBranch ?? null,
          branchName: init.branchName ?? null,
        }
      : null
  return {
    ...input,
    repository,
    secretEnv: {
      ...init?.secretEnv,
      ...input.secretEnv,
    },
  } satisfies RuntimeSendRequest
}

export function startServer(runtimeName: HarnessRuntimeName): ReturnType<typeof createServer> {
  const runtime = createCodingAgentRuntime(runtimeName)
  const state: ServerState = {
    init: null,
    running: null,
  }

  const server = createServer(async (request, response) => {
    let requestPath = "/"
    try {
      const url = new URL(request.url ?? "/", "http://container.local")
      requestPath = url.pathname
      if (request.method === "GET" && url.pathname === "/health") {
        jsonResponse(response, 200, { ok: true, runtime: runtimeName })
        return
      }
      if (request.method === "POST" && url.pathname === "/init") {
        const body = await readJson<RuntimeInitRequest>(request)
        state.init = body
        await initializeWorkspace(body)
        await runtime.switchSession(body.sessionId)
        jsonResponse(response, 200, { ok: true })
        return
      }
      if (request.method === "POST" && url.pathname === "/switch-session") {
        const body = await readJson<{ sessionId: string }>(request)
        await runtime.switchSession(body.sessionId)
        jsonResponse(response, 200, { ok: true })
        return
      }
      if (request.method === "GET" && url.pathname === "/current-session") {
        jsonResponse(response, 200, { sessionId: runtime.currentSession() })
        return
      }
      if (request.method === "POST" && url.pathname === "/send") {
        if (state.running) {
          jsonResponse(response, 409, { error: "Agent runtime is already running a prompt" })
          return
        }
        const body = mergeSendWithInit(await readJson<RuntimeSendRequest>(request), state.init)
        const cursor = runtime.currentCursor()
        state.running = runtime.send(body).finally(() => {
          state.running = null
        })
        jsonResponse(response, 202, { ok: true, cursor } satisfies RuntimeSendResponse)
        return
      }
      if (request.method === "POST" && url.pathname === "/interrupt") {
        const running = state.running
        await runtime.interrupt()
        await running
        jsonResponse(response, 200, { ok: true })
        return
      }
      if (request.method === "GET" && url.pathname === "/poll") {
        const cursor = Number(url.searchParams.get("cursor") ?? "0")
        jsonResponse(response, 200, runtime.poll(Number.isFinite(cursor) ? cursor : 0))
        return
      }
      if (request.method === "GET" && url.pathname === "/read-file") {
        const path = url.searchParams.get("path")
        if (!path) {
          jsonResponse(response, 400, { error: "path is required" })
          return
        }
        const content = await readWorkspaceTextFile(path)
        if (content === null) {
          response.writeHead(404)
          response.end()
          return
        }
        textResponse(response, 200, content)
        return
      }
      if (request.method === "GET" && url.pathname === "/list-files") {
        const path = url.searchParams.get("path") ?? "."
        jsonResponse(response, 200, { files: await listWorkspaceFiles(path) })
        return
      }
      jsonResponse(response, 404, { error: "Not found" })
    } catch (error) {
      // This Node callback is the Effect runtime boundary for the container HTTP server.
      // Await the log so the full exception and stack are emitted before sending the redacted 500.
      await Effect.runPromise(
        logRequestFailure(error, {
          method: request.method ?? "UNKNOWN",
          path: requestPath,
          runtimeKind: runtimeName,
        }),
      )
      jsonResponse(response, 500, { error: "Internal server error" })
    }
  })

  const port = Number(process.env.PORT ?? "8787")
  server.listen(port, "0.0.0.0")
  return server
}
