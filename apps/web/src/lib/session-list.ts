import {
  summarizeSessionTools,
  type AgentRuntime,
  type OpenCodeMcpServers,
  type SessionInitiationSource,
  type SessionKind,
  type SessionStatus,
  type SessionToolSpec,
  type UnavailableSessionTool,
} from "@solzero/shared"
import { isInactiveSession } from "@/lib/time"

export interface SessionItem {
  id: string
  sessionKind?: SessionKind
  agentRuntime?: AgentRuntime
  source?: SessionInitiationSource
  title: string | null
  repoOwner: string
  repoName: string
  branchName?: string | null
  tools?: SessionToolSpec[]
  unavailableTools?: UnavailableSessionTool[]
  customMcpServers?: OpenCodeMcpServers
  model?: string
  reasoningEffort?: string
  incognito?: boolean
  status: SessionStatus | string
  createdAt: number
  updatedAt: number
}

export interface ArchiveSessionFailure {
  sessionId: string
  status: number | null
  message: string
}

export function formatSessionLabel(
  session: Pick<SessionItem, "repoOwner" | "repoName" | "tools" | "customMcpServers">,
): string {
  const tools =
    session.tools && session.tools.length > 0
      ? session.tools
      : session.repoOwner && session.repoName
        ? [
            {
              kind: "github_repo" as const,
              repoOwner: session.repoOwner,
              repoName: session.repoName,
            },
          ]
        : []

  return summarizeSessionTools(tools, {
    emptyLabel: "No tools",
    customMcpServers: session.customMcpServers,
  })
}

export function getSessionSourceLabel(source: SessionInitiationSource | undefined): string {
  switch (source) {
    case "slack":
      return "Started from Slack"
    case "api":
      return "Started from API"
    case "web":
    default:
      return "Started from web"
  }
}

export function isActiveSession(session: Pick<SessionItem, "status" | "createdAt" | "updatedAt">) {
  if (session.status === "archived") {
    return false
  }
  if (session.status === "active" || session.status === "created") {
    return true
  }
  return !isInactiveSession(session.updatedAt || session.createdAt)
}

export async function archiveSession(sessionId: string): Promise<ArchiveSessionFailure | null> {
  let response: Response
  try {
    response = await fetch(`/api/sessions/${sessionId}/archive`, {
      method: "POST",
    })
  } catch (errorValue) {
    return {
      sessionId,
      status: null,
      message: errorValue instanceof Error ? errorValue.message : "Network request failed",
    }
  }

  if (response.ok) {
    return null
  }

  return {
    sessionId,
    status: response.status,
    message: await getArchiveFailureMessage(response),
  }
}

async function getArchiveFailureMessage(response: Response): Promise<string> {
  try {
    const contentType = response.headers.get("content-type") ?? ""
    if (contentType.includes("application/json")) {
      const body = (await response.json()) as { error?: unknown; message?: unknown }
      if (typeof body.error === "string" && body.error.length > 0) {
        return body.error
      }
      if (typeof body.message === "string" && body.message.length > 0) {
        return body.message
      }
    } else {
      const text = await response.text()
      if (text.trim().length > 0) {
        return text.trim()
      }
    }
  } catch {
    // Fall back to the HTTP status text below.
  }

  return response.statusText || "Request failed"
}
