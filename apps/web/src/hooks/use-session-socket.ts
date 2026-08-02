"use client"

import type {
  OpenCodeInteractionResponse,
  ParticipantPresence,
  RuntimeActivityEvent,
  SandboxEvent,
  ServerMessage,
  SessionState,
} from "@c0-agent/shared"
import { useCallback, useEffect, useRef, useState } from "react"
import { getWebSocketOrigin } from "@/lib/runtime-config"
import { shouldClearProcessingForRuntimeStatus } from "@/lib/runtime-status"
import { fetchSessionWsToken } from "@/lib/session-ws-token"
import type { Artifact } from "@/types/session"

// WebSocket close codes
const WS_CLOSE_AUTH_REQUIRED = 4001
const WS_CLOSE_SESSION_EXPIRED = 4002

function normalizeRuntimeProcessingState(state: SessionState): SessionState {
  return shouldClearProcessingForRuntimeStatus(state.runtimeStatus ?? state.sandboxStatus)
    ? { ...state, isProcessing: false }
    : state
}

class WsTokenRequestError extends Error {
  constructor(
    readonly status: number | null,
    message: string,
  ) {
    super(message)
    this.name = "WsTokenRequestError"
  }
}

interface Message {
  id: string
  authorId: string
  content: string
  source: string
  status: string
  createdAt: number
}

interface UseSessionSocketReturn {
  connected: boolean
  connecting: boolean
  authError: string | null
  connectionError: string | null
  sessionState: SessionState | null
  messages: Message[]
  events: SandboxEvent[]
  runtimeActivity: RuntimeActivityEvent[]
  runtimeActivityLoading: boolean
  runtimeActivityError: string | null
  participants: ParticipantPresence[]
  artifacts: Artifact[]
  currentParticipantId: string | null
  isProcessing: boolean
  hasMoreHistory: boolean
  loadingHistory: boolean
  sendPrompt: (content: string, model?: string, reasoningEffort?: string) => void
  replyToInteraction: (response: OpenCodeInteractionResponse) => void
  stopExecution: () => void
  sendTyping: () => void
  reconnect: () => void
  loadOlderEvents: () => void
}

export function useSessionSocket(sessionId: string): UseSessionSocketReturn {
  const wsRef = useRef<WebSocket | null>(null)
  const connectingRef = useRef(false)
  const mountedRef = useRef(true)
  const subscribedRef = useRef(false)
  const wsTokenRef = useRef<string | null>(null)
  const wsTokenRequestRef = useRef<Promise<string> | null>(null)
  const connectionGenerationRef = useRef(0)
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [sessionState, setSessionState] = useState<SessionState | null>(null)
  const [messages, _setMessages] = useState<Message[]>([])
  const [events, setEvents] = useState<SandboxEvent[]>([])
  const [runtimeActivity, setRuntimeActivity] = useState<RuntimeActivityEvent[]>([])
  const [runtimeActivityLoading, setRuntimeActivityLoading] = useState(true)
  const [runtimeActivityError, setRuntimeActivityError] = useState<string | null>(null)
  const [participants, setParticipants] = useState<ParticipantPresence[]>([])
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [currentParticipantId, setCurrentParticipantId] = useState<string | null>(null)
  const currentParticipantRef = useRef<{
    participantId: string
    name: string
    avatar?: string
  } | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const reconnectAttempts = useRef(0)

  // Pagination state
  const [hasMoreHistory, setHasMoreHistory] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const cursorRef = useRef<{ timestamp: number; id: string } | null>(null)

  // Live event buffering during replay
  const replayCompleteRef = useRef(false)
  const liveEventBufferRef = useRef<SandboxEvent[]>([])

  useEffect(() => {
    connectionGenerationRef.current += 1
    wsTokenRef.current = null
    wsTokenRequestRef.current = null
    subscribedRef.current = false
    currentParticipantRef.current = null
    cursorRef.current = null
    replayCompleteRef.current = false
    liveEventBufferRef.current = []

    setConnected(false)
    setConnecting(false)
    setAuthError(null)
    setConnectionError(null)
    setSessionState(null)
    _setMessages([])
    setEvents([])
    setRuntimeActivity([])
    setRuntimeActivityLoading(true)
    setRuntimeActivityError(null)
    setParticipants([])
    setArtifacts([])
    setCurrentParticipantId(null)
    setHasMoreHistory(false)
    setLoadingHistory(false)
  }, [sessionId])

  /**
   * Process a single sandbox_event through the existing logic.
   * Extracted so it can be called both for live events and flushed buffer.
   */
  const processSandboxEvent = useCallback((event: SandboxEvent) => {
    setEvents((prev) => [...prev, event])
    if (event.type === "execution_complete") {
      setSessionState((prev) => (prev ? { ...prev, isProcessing: false } : null))
      return
    }
    if (event.type === "error") {
      setSessionState((prev) =>
        prev
          ? {
              ...prev,
              isProcessing: false,
              sandboxStatus: "failed",
              runtimeStatus: "failed",
              runtimeError: event.error ?? "Execution failed",
            }
          : null,
      )
    }
  }, [])

  const handleMessage = useCallback(
    (data: ServerMessage) => {
      switch (data.type) {
        case "subscribed":
          console.log("WebSocket subscribed to session")
          subscribedRef.current = true
          // Clear existing state since we're about to receive fresh history
          setEvents([])
          setArtifacts([])
          // Reset replay buffering state
          replayCompleteRef.current = false
          liveEventBufferRef.current = []
          if (data.state) {
            setSessionState(normalizeRuntimeProcessingState(data.state))
          }
          // Store the current user's participant ID and info for author attribution
          if (data.participantId) {
            setCurrentParticipantId(data.participantId)
          }
          // Initialize participant ref immediately for sendPrompt author attribution
          if (data.participant) {
            currentParticipantRef.current = data.participant
          }
          break

        case "session_state":
          if (data.state) {
            setSessionState(normalizeRuntimeProcessingState(data.state))
          }
          break

        case "prompt_queued":
          // Could show queue position indicator
          break

        case "sandbox_event":
          if (data.event) {
            const event = data.event

            // Buffer live events during initial replay to avoid interleaving
            if (!replayCompleteRef.current) {
              liveEventBufferRef.current.push(event)
            } else {
              processSandboxEvent(event)
            }
          }
          break

        case "replay_complete": {
          // Mark replay as complete
          replayCompleteRef.current = true

          // Set pagination state
          setHasMoreHistory(data.hasMore ?? false)
          cursorRef.current = data.cursor ?? null

          // Flush buffered live events in a single state update
          const buffered = liveEventBufferRef.current
          liveEventBufferRef.current = []
          if (buffered.length > 0) {
            setEvents((prev) => [...prev, ...buffered])
          }
          break
        }

        case "runtime_activity_snapshot": {
          setRuntimeActivity(Array.isArray(data.activity) ? data.activity : [])
          setRuntimeActivityLoading(false)
          setRuntimeActivityError(null)
          break
        }

        case "runtime_activity": {
          if (data.activity && !Array.isArray(data.activity)) {
            const activity = data.activity
            setRuntimeActivity((prev) => {
              const existingIndex = prev.findIndex((item) => item.id === activity.id)
              if (existingIndex >= 0) {
                const next = [...prev]
                next[existingIndex] = activity
                return next
              }
              return [...prev, activity]
            })
          }
          setRuntimeActivityLoading(false)
          setRuntimeActivityError(null)
          break
        }

        case "history_page": {
          if (data.items) {
            // Prepend older events to the beginning
            setEvents((prev) => [...data.items!, ...prev])
          }
          setHasMoreHistory(data.hasMore ?? false)
          cursorRef.current = data.cursor ?? null
          setLoadingHistory(false)
          break
        }

        case "presence_sync":
        case "presence_update":
          if (data.participants) {
            setParticipants(data.participants)
            // Update current participant info for author attribution
            setCurrentParticipantId((currentId) => {
              if (currentId) {
                const currentParticipant = data.participants!.find(
                  (p) => p.participantId === currentId,
                )
                if (currentParticipant) {
                  currentParticipantRef.current = {
                    participantId: currentParticipant.participantId,
                    name: currentParticipant.name,
                    avatar: currentParticipant.avatar,
                  }
                }
              }
              return currentId
            })
          }
          break

        case "presence_leave":
          if (data.userId) {
            setParticipants((prev) => prev.filter((p) => p.userId !== data.userId))
          }
          break

        case "sandbox_warming":
          setSessionState((prev) =>
            prev
              ? { ...prev, sandboxStatus: "warming", runtimeStatus: "warming", runtimeError: null }
              : null,
          )
          break

        case "sandbox_spawning":
          setSessionState((prev) =>
            prev
              ? {
                  ...prev,
                  sandboxStatus: "spawning",
                  runtimeStatus: "spawning",
                  runtimeError: null,
                }
              : null,
          )
          break

        case "sandbox_status":
          if (data.status) {
            const status = data.status
            setSessionState((prev) =>
              prev
                ? {
                    ...prev,
                    isProcessing: shouldClearProcessingForRuntimeStatus(status)
                      ? false
                      : prev.isProcessing,
                    sandboxStatus: status,
                    runtimeStatus: status,
                    runtimeError: status === "failed" ? prev.runtimeError : null,
                  }
                : null,
            )
          }
          break

        case "sandbox_ready":
          setSessionState((prev) =>
            prev
              ? {
                  ...prev,
                  isProcessing: false,
                  sandboxStatus: "ready",
                  runtimeStatus: "ready",
                }
              : null,
          )
          break

        case "artifact_created":
          if (data.artifact) {
            const artifact = data.artifact
            setArtifacts((prev) => {
              // Avoid duplicates
              const existing = prev.find((a) => a.id === artifact.id)
              if (existing) {
                return prev.map((a) => (a.id === artifact.id ? artifact : a))
              }
              return [...prev, artifact]
            })
          }
          break

        case "artifact_updated":
          if (data.artifact) {
            const artifact = data.artifact
            setArtifacts((prev) => prev.map((a) => (a.id === artifact.id ? artifact : a)))
          }
          break

        case "session_status":
          if (data.status) {
            setSessionState((prev) => (prev ? { ...prev, status: data.status! } : null))
          }
          break

        case "processing_status":
          if (typeof data.isProcessing === "boolean") {
            const isProcessing = data.isProcessing
            setSessionState((prev) =>
              prev
                ? {
                    ...prev,
                    isProcessing: shouldClearProcessingForRuntimeStatus(
                      prev.runtimeStatus ?? prev.sandboxStatus,
                    )
                      ? false
                      : isProcessing,
                  }
                : null,
            )
          }
          break

        case "sandbox_error":
          console.error("Sandbox error:", data.error)
          setSessionState((prev) =>
            prev
              ? {
                  ...prev,
                  isProcessing: false,
                  sandboxStatus: "failed",
                  runtimeStatus: "failed",
                  runtimeError: data.error ?? "Sandbox failed",
                }
              : null,
          )
          break

        case "pong":
          // Health check response
          break

        case "error":
          console.error("Session error:", data)
          // Reset loading state if a fetch_history request was rejected
          setLoadingHistory(false)
          break
      }
    },
    [processSandboxEvent],
  )

  const fetchWsToken = useCallback(async (): Promise<string> => {
    if (wsTokenRequestRef.current) {
      return wsTokenRequestRef.current
    }

    const request = (async () => {
      const response = await fetchSessionWsToken(sessionId)

      if (!response.ok) {
        if (response.status === 401) {
          throw new WsTokenRequestError(response.status, "Please sign in to connect")
        }
        const error = await response.text()
        throw new WsTokenRequestError(
          response.status,
          error || `Failed to create websocket token (${response.status})`,
        )
      }

      const data = (await response.json()) as { token?: unknown }
      if (typeof data.token !== "string" || data.token.length === 0) {
        throw new WsTokenRequestError(null, "Websocket token response did not include a token")
      }
      return data.token
    })()

    wsTokenRequestRef.current = request
    try {
      return await request
    } finally {
      if (wsTokenRequestRef.current === request) {
        wsTokenRequestRef.current = null
      }
    }
  }, [sessionId])

  const connect = useCallback(async () => {
    const connectionGeneration = connectionGenerationRef.current

    // Use ref to avoid race conditions with React StrictMode
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log("WebSocket already open")
      return
    }
    if (wsRef.current?.readyState === WebSocket.CONNECTING) {
      console.log("WebSocket already connecting")
      return
    }
    if (connectingRef.current) {
      console.log("Connection in progress (ref)")
      return
    }

    connectingRef.current = true
    setConnecting(true)
    setAuthError(null)

    // Fetch a WebSocket auth token first
    if (!wsTokenRef.current) {
      let token: string
      try {
        token = await fetchWsToken()
      } catch (error) {
        if (!mountedRef.current || connectionGeneration !== connectionGenerationRef.current) {
          connectingRef.current = false
          setConnecting(false)
          return
        }
        console.error("Failed to fetch WS token:", error)
        setAuthError(
          error instanceof WsTokenRequestError && error.status === 401
            ? error.message
            : "Failed to authenticate session connection",
        )
        connectingRef.current = false
        setConnecting(false)
        return
      }
      if (!mountedRef.current || connectionGeneration !== connectionGenerationRef.current) {
        connectingRef.current = false
        setConnecting(false)
        return
      }
      const currentSocket = wsRef.current
      if (
        currentSocket?.readyState === WebSocket.OPEN ||
        currentSocket?.readyState === WebSocket.CONNECTING
      ) {
        connectingRef.current = false
        setConnecting(false)
        return
      }
      wsTokenRef.current = token
    }

    const subscribeToken = wsTokenRef.current
    if (!subscribeToken) {
      connectingRef.current = false
      setConnecting(false)
      setAuthError("Failed to authenticate session connection")
      return
    }
    const wsUrl = `${getWebSocketOrigin()}/sessions/${sessionId}/ws`
    console.log("WebSocket connecting to:", wsUrl)

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      if (connectionGeneration !== connectionGenerationRef.current || wsRef.current !== ws) {
        ws.close()
        return
      }
      if (!mountedRef.current) {
        ws.close()
        return
      }
      console.log("WebSocket connected!")
      connectingRef.current = false
      setConnected(true)
      setConnecting(false)
      reconnectAttempts.current = 0

      // Subscribe to session with the auth token
      ws.send(
        JSON.stringify({
          type: "subscribe",
          token: subscribeToken,
          clientId: crypto.randomUUID(),
        }),
      )
    }

    ws.onmessage = (event) => {
      if (connectionGeneration !== connectionGenerationRef.current || wsRef.current !== ws) {
        return
      }
      try {
        const data = JSON.parse(event.data)
        handleMessage(data)
      } catch (error) {
        console.error("Failed to parse WebSocket message:", error)
      }
    }

    ws.onclose = (event) => {
      if (connectionGeneration !== connectionGenerationRef.current || wsRef.current !== ws) {
        return
      }
      console.log("WebSocket closed:", {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
      })
      connectingRef.current = false
      subscribedRef.current = false
      setConnected(false)
      setConnecting(false)
      wsRef.current = null

      // Handle authentication errors
      if (event.code === WS_CLOSE_AUTH_REQUIRED) {
        const reason = event.reason.trim()
        setAuthError(
          reason
            ? `Session connection authentication failed: ${reason}. Reconnect to get a fresh token.`
            : "Session connection authentication failed. Reconnect to get a fresh token.",
        )
        // Clear the token so we fetch a new one on reconnect
        wsTokenRef.current = null
        wsTokenRequestRef.current = null
        return
      }

      // Handle session expired (e.g., after server hibernation)
      if (event.code === WS_CLOSE_SESSION_EXPIRED) {
        setConnectionError("Agent expired. Please reconnect.")
        wsTokenRef.current = null
        wsTokenRequestRef.current = null
        return
      }

      // Only reconnect if mounted and not a clean close
      if (mountedRef.current && !event.wasClean) {
        wsTokenRef.current = null
        wsTokenRequestRef.current = null
        if (reconnectAttempts.current < 5) {
          const delay = Math.min(1000 * 2 ** reconnectAttempts.current, 30000)
          reconnectAttempts.current++
          console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current})`)

          reconnectTimeoutRef.current = setTimeout(() => {
            if (mountedRef.current) {
              connect()
            }
          }, delay)
        } else {
          // Exhausted reconnection attempts
          console.error("WebSocket reconnection failed after 5 attempts")
          setConnectionError("Connection lost. Please check your network and try reconnecting.")
        }
      }
    }

    ws.onerror = (error) => {
      if (connectionGeneration !== connectionGenerationRef.current || wsRef.current !== ws) {
        return
      }
      console.error("WebSocket error event:", error)
    }
  }, [sessionId, handleMessage, fetchWsToken])

  const sendPrompt = useCallback((content: string, model?: string, reasoningEffort?: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.error("WebSocket not connected")
      return
    }

    if (!subscribedRef.current) {
      console.error("Not subscribed yet, waiting...")
      // Retry after a short delay
      setTimeout(() => sendPrompt(content, model, reasoningEffort), 500)
      return
    }

    console.log("Sending prompt:", content, "with model:", model, "reasoning:", reasoningEffort)

    // Optimistically set isProcessing for immediate feedback
    // Server will confirm with processing_status message
    setSessionState((prev) => (prev ? { ...prev, isProcessing: true } : null))

    // Note: user_message event is NOT inserted optimistically here.
    // The server writes a user_message event to the events table and broadcasts it
    // to all clients (including the sender), which handles both display and multiplayer.

    wsRef.current.send(
      JSON.stringify({
        type: "prompt",
        content,
        model, // Include model for per-message model switching
        reasoningEffort,
      }),
    )
  }, [])

  const stopExecution = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return
    }
    wsRef.current.send(JSON.stringify({ type: "stop" }))
  }, [])

  const replyToInteraction = useCallback((response: OpenCodeInteractionResponse) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return
    }
    wsRef.current.send(
      JSON.stringify({
        type: "interaction_reply",
        ...response,
      }),
    )
  }, [])

  const sendTyping = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return
    }
    wsRef.current.send(JSON.stringify({ type: "typing" }))
  }, [])

  const loadOlderEvents = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    if (!hasMoreHistory || loadingHistory || !cursorRef.current) return
    setLoadingHistory(true)
    wsRef.current.send(
      JSON.stringify({
        type: "fetch_history",
        cursor: cursorRef.current,
        limit: 200,
      }),
    )
  }, [hasMoreHistory, loadingHistory])

  const reconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    connectingRef.current = false
    reconnectAttempts.current = 0
    wsTokenRef.current = null // Clear token to fetch fresh one
    wsTokenRequestRef.current = null
    setAuthError(null)
    setConnectionError(null)
    connect()
  }, [connect])

  // Connect on mount
  useEffect(() => {
    mountedRef.current = true
    connect()

    return () => {
      mountedRef.current = false
      connectionGenerationRef.current += 1
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
      subscribedRef.current = false
      connectingRef.current = false
    }
  }, [connect])

  // Ping every 30 seconds to keep connection alive
  useEffect(() => {
    const pingInterval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "ping" }))
      }
    }, 30000)

    return () => clearInterval(pingInterval)
  }, [])

  const isProcessing = sessionState?.isProcessing ?? false

  return {
    connected,
    connecting,
    authError,
    connectionError,
    sessionState,
    messages,
    events,
    runtimeActivity,
    runtimeActivityLoading,
    runtimeActivityError,
    participants,
    artifacts,
    currentParticipantId,
    isProcessing,
    hasMoreHistory,
    loadingHistory,
    sendPrompt,
    replyToInteraction,
    stopExecution,
    sendTyping,
    reconnect,
    loadOlderEvents,
  }
}
