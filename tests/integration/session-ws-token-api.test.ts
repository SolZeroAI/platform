import { describe, expect, it } from "vitest"
import { fetchSessionWsToken } from "../../apps/web/src/lib/session-ws-token"
import { mockFetchResponse } from "./fetch-test-helpers"

describe("session websocket token API helper", () => {
  it("sends an empty JSON payload so the Effect API can decode the request body", async () => {
    const fetchSpy = mockFetchResponse(
      Response.json({
        token: "token-123",
        participantId: "participant-123",
      }),
    )

    const response = await fetchSessionWsToken("session-123")

    expect(response.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/sessions/session-123/ws-token",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: "{}",
      }),
    )
  })
})
