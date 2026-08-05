import type {
  CreateSessionInput,
  PromptInput,
  RuntimeActivityResponse,
  SessionKind,
  SessionSummary,
  SubagentMode,
  TimelineEvent,
  UpdateSessionToolsRequest,
  WsSubscribePayload,
} from "@solzero/shared"

export type BackgroundClientAuth =
  | {
      kind: "api-key"
      apiKey: string
    }
  | {
      kind: "browser-session"
    }

export interface BackgroundClientOptions {
  baseUrl: string
  auth: BackgroundClientAuth
}

export class BackgroundSessionsClient {
  private readonly auth: BackgroundClientAuth
  private readonly baseUrl: string

  constructor(options: BackgroundClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "")
    this.auth = normalizeAuth(options.auth)
  }

  private request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    headers.delete("authorization")
    headers.delete("x-api-key")

    if (this.auth.kind === "api-key") {
      headers.set("x-api-key", this.auth.apiKey)
    }

    return fetch(`${this.baseUrl}${path}`, {
      ...init,
      credentials: this.auth.kind === "api-key" ? "omit" : "include",
      headers,
    })
  }

  async listSessions(
    limit = 50,
    offset = 0,
  ): Promise<{
    sessions: SessionSummary[]
    total: number
    hasMore: boolean
  }> {
    const response = await this.request(`/sessions?limit=${limit}&offset=${offset}`)
    if (!response.ok) {
      throw new Error(`Failed to list sessions: ${response.status}`)
    }
    return response.json()
  }

  async createSession(input: CreateSessionInput): Promise<{
    sessionId: string
    sessionKind: SessionKind
    status: string
  }> {
    const response = await this.request("/sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    })
    if (!response.ok) {
      throw new Error(`Failed to create session: ${response.status}`)
    }
    return response.json()
  }

  async createWsToken(
    sessionId: string,
    user: {
      userId: string
      githubLogin?: string
      githubName?: string
      githubEmail?: string
    },
  ): Promise<{ token: string; participantId: string }> {
    const response = await this.request(`/sessions/${sessionId}/ws-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(user),
    })
    if (!response.ok) {
      throw new Error(`Failed to create ws token: ${response.status}`)
    }
    return response.json()
  }

  async prompt(
    sessionId: string,
    input: PromptInput,
  ): Promise<{ messageId: string; status: string }> {
    const response = await this.request(`/sessions/${sessionId}/prompt`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    })
    if (!response.ok) {
      throw new Error(`Failed to enqueue prompt: ${response.status}`)
    }
    return response.json()
  }

  async updateSessionTools(
    sessionId: string,
    input: UpdateSessionToolsRequest,
  ): Promise<{
    id: string
    repoOwner: string
    repoName: string
    isolateStepLimit?: number
    subagents?: SubagentMode
    updatedAt: number
  }> {
    const response = await this.request(`/sessions/${sessionId}/tools`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    })
    if (!response.ok) {
      throw new Error(`Failed to update session tools: ${response.status}`)
    }
    return response.json()
  }

  async getSandboxActivity(sessionId: string, limit = 100): Promise<RuntimeActivityResponse> {
    const response = await this.request(`/sessions/${sessionId}/sandbox/activity?limit=${limit}`)
    if (!response.ok) {
      throw new Error(`Failed to fetch sandbox activity: ${response.status}`)
    }
    return response.json()
  }

  subscribeToSession(
    sessionId: string,
    subscribePayload: WsSubscribePayload,
    onEvent: (event: TimelineEvent) => void,
    onRawMessage?: (data: unknown) => void,
  ): WebSocket {
    const wsProtocol = this.baseUrl.startsWith("https") ? "wss" : "ws"
    const wsBase = this.baseUrl.replace(/^https?/, wsProtocol)
    const ws = new WebSocket(`${wsBase}/sessions/${sessionId}/ws`)

    ws.addEventListener("open", () => {
      ws.send(
        JSON.stringify({
          type: "subscribe",
          token: subscribePayload.token,
          clientId: subscribePayload.clientId,
        }),
      )
    })

    ws.addEventListener("message", (raw) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(String(raw.data))
      } catch {
        return
      }

      onRawMessage?.(parsed)
      if (
        parsed &&
        typeof parsed === "object" &&
        "type" in parsed &&
        parsed.type === "sandbox_event" &&
        "event" in parsed
      ) {
        onEvent((parsed as { event: TimelineEvent }).event)
      }
    })

    return ws
  }
}

function normalizeAuth(auth: BackgroundClientAuth): BackgroundClientAuth {
  if (auth.kind === "browser-session") {
    return auth
  }

  const apiKey = auth.apiKey.trim()
  if (!apiKey) {
    throw new Error("BackgroundSessionsClient API key must not be empty")
  }
  return { kind: "api-key", apiKey }
}
