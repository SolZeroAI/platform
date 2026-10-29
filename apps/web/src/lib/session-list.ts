import type { SessionListItem } from "@solzero/api"
import {
  getErrorMessage,
  summarizeSessionTools,
  type SessionInitiationSource,
} from "@solzero/shared"
import { runApi } from "@/lib/api-client"

export type SessionItem = SessionListItem

export interface ArchiveSessionFailure {
  sessionId: string
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

/** Archives one session. Resolves with the failure instead of rejecting, so callers can batch archives. */
export async function archiveSession(sessionId: string): Promise<ArchiveSessionFailure | null> {
  try {
    await runApi((client) => client.sessions.archive({ params: { id: sessionId } }))

    return null
  } catch (errorValue) {
    return { sessionId, message: getErrorMessage(errorValue, "Request failed") }
  }
}
