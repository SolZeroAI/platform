import { describe, expect, it } from "vitest"
import {
  buildSlackLinkSettingsPath,
  formatSlackLinkError,
  normalizeSlackUserId,
  parseSlackLinkStatus,
} from "./slack-linking"
import {
  buildOktaReconnectSessionPath,
  buildOktaReconnectSettingsPath,
  formatOktaReconnectError,
  parseOktaReconnectStatus,
  resolveOAuthCallbackError,
} from "./okta-reconnect"

describe("Slack settings linking helpers", () => {
  it("normalizes Slack user ids from setup URLs", () => {
    expect(normalizeSlackUserId(" U01J6SKQK8W ")).toBe("U01J6SKQK8W")
    expect(normalizeSlackUserId("")).toBeUndefined()
  })

  it("parses only known Slack link states", () => {
    expect(parseSlackLinkStatus("complete")).toBe("complete")
    expect(parseSlackLinkStatus("error")).toBe("error")
    expect(parseSlackLinkStatus("pending")).toBeUndefined()
  })

  it("builds relative callback URLs for Better Auth", () => {
    expect(buildSlackLinkSettingsPath("U01J6SKQK8W")).toBe("/settings?slackUserId=U01J6SKQK8W")
    expect(buildSlackLinkSettingsPath("U01J6SKQK8W", "complete")).toBe(
      "/settings?slackUserId=U01J6SKQK8W&slackLink=complete",
    )
  })

  it("formats provider errors without hiding the provider code", () => {
    expect(formatSlackLinkError("access_denied")).toBe(
      "Slack authorization did not complete: access_denied.",
    )
    expect(formatSlackLinkError(undefined)).toBe("Slack authorization did not complete.")
  })
})

describe("Okta reconnect settings helpers", () => {
  it("parses only known reconnect states", () => {
    expect(parseOktaReconnectStatus("1")).toBe("1")
    expect(parseOktaReconnectStatus("complete")).toBe("complete")
    expect(parseOktaReconnectStatus("error")).toBe("error")
    expect(parseOktaReconnectStatus("pending")).toBeUndefined()
  })

  it("builds a deep link to the API access Okta reconnect panel", () => {
    expect(buildOktaReconnectSettingsPath()).toBe(
      "/settings?category=api-access&oktaReconnect=1#okta-access",
    )
    expect(buildOktaReconnectSettingsPath("complete")).toBe(
      "/settings?category=api-access&oktaReconnect=complete#okta-access",
    )
    expect(buildOktaReconnectSettingsPath("complete", { hash: false })).toBe(
      "/settings?category=api-access&oktaReconnect=complete",
    )
    expect(buildOktaReconnectSettingsPath("error", { hash: false })).toBe(
      "/settings?category=api-access&oktaReconnect=error",
    )
    expect(buildOktaReconnectSessionPath("session-123", "complete")).toBe(
      "/session/session-123?oktaReconnect=complete",
    )
    expect(
      buildOktaReconnectSessionPath("session-123", "complete", {
        resumeMessageId: "message-123",
      }),
    ).toBe("/session/session-123?oktaReconnect=complete&resumeMessageId=message-123")
  })

  it("formats Okta authentication provider errors", () => {
    expect(formatOktaReconnectError("access_denied")).toBe(
      "Okta authentication did not complete: access_denied.",
    )
    expect(formatOktaReconnectError(undefined)).toBe("Okta authentication did not complete.")
  })

  it("prefers provider error descriptions over error codes", () => {
    expect(resolveOAuthCallbackError("access_denied", "User denied access")).toBe(
      "User denied access",
    )
    expect(resolveOAuthCallbackError("access_denied", undefined)).toBe("access_denied")
    expect(resolveOAuthCallbackError(undefined, undefined)).toBeUndefined()
  })
})
