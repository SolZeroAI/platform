import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { dynamicTool, jsonSchema, type ToolSet } from "@ai-sdk/provider-utils"
import type { RuntimeMcpServer, RuntimeMcpServers } from "./types"

const DEFAULT_MCP_TIMEOUT_MS = 30_000

interface ConnectedMcpServer {
  name: string
  client: Client
  timeout: number
  tools: Awaited<ReturnType<Client["listTools"]>>["tools"]
}

export interface McpTools {
  tools: ToolSet
  close(): Promise<void>
}

function processEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )
}

function transportForServer(name: string, server: RuntimeMcpServer) {
  if (server.type === "local") {
    const [command, ...args] = server.command
    if (!command) {
      throw new Error(`MCP server '${name}' has no command`)
    }
    return new StdioClientTransport({
      command,
      args,
      cwd: process.env.WORKSPACE_ROOT,
      env: { ...processEnvironment(), ...server.environment },
      stderr: "pipe",
    })
  }
  if (server.oauth) {
    throw new Error(
      `MCP server '${name}' requires OAuth, which is not available in agent containers`,
    )
  }
  return new StreamableHTTPClientTransport(new URL(server.url), {
    requestInit: { headers: server.headers },
  })
}

async function connectServer(name: string, server: RuntimeMcpServer): Promise<ConnectedMcpServer> {
  const timeout = server.timeout ?? DEFAULT_MCP_TIMEOUT_MS
  const client = new Client({ name: `s0-agent-${name}`, version: "1.0.0" })
  try {
    await client.connect(transportForServer(name, server), {
      timeout,
      maxTotalTimeout: timeout,
    })
    const response = await client.listTools(undefined, { timeout, maxTotalTimeout: timeout })
    return { name, client, timeout, tools: response.tools }
  } catch (error) {
    await client.close().catch(() => undefined)
    throw error
  }
}

function safeToolName(value: string): string {
  const normalized = value.replaceAll(/[^a-zA-Z0-9_-]/g, "_")
  return normalized.length > 0 ? normalized : "tool"
}

function errorText(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = (result as { content?: unknown }).content
  if (!Array.isArray(content)) {
    return "MCP tool failed"
  }
  const text = content
    .filter(
      (part): part is { type: "text"; text: string } =>
        typeof part === "object" &&
        part !== null &&
        Reflect.get(part, "type") === "text" &&
        typeof Reflect.get(part, "text") === "string",
    )
    .map((part) => part.text)
    .join("\n")
  return text || "MCP tool failed"
}

export async function createMcpTools(servers: RuntimeMcpServers = {}): Promise<McpTools> {
  const enabledServers = Object.entries(servers).filter(([, server]) => server.enabled !== false)
  const connected: ConnectedMcpServer[] = []
  try {
    for (const [name, server] of enabledServers) {
      connected.push(await connectServer(name, server))
    }
  } catch (error) {
    await Promise.all(connected.map((server) => server.client.close().catch(() => undefined)))
    throw error
  }
  const tools: ToolSet = {}

  for (const server of connected) {
    for (const definition of server.tools) {
      const name = safeToolName(`${server.name}_${definition.name}`)
      tools[name] = dynamicTool({
        description: definition.description ?? `${definition.name} from ${server.name}`,
        inputSchema: jsonSchema(definition.inputSchema),
        execute: async (input) => {
          const result = await server.client.callTool(
            { name: definition.name, arguments: input as Record<string, unknown> },
            undefined,
            { timeout: server.timeout, maxTotalTimeout: server.timeout },
          )
          if ("isError" in result && result.isError) {
            throw new Error(errorText(result))
          }
          return result
        },
      })
    }
  }

  return {
    tools,
    async close() {
      await Promise.all(connected.map((server) => server.client.close().catch(() => undefined)))
    },
  }
}
