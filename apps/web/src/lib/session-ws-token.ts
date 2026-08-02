export interface SessionWsTokenResponse {
  token: string
  participantId: string
}

export function fetchSessionWsToken(sessionId: string): Promise<Response> {
  return fetch(`/api/sessions/${sessionId}/ws-token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  })
}
