import { describe, expect, it } from "vitest"
import {
  formatMcpcfAuthLabel,
  getMcpcfServerDescription,
  getMcpcfServerDisplayLabel,
  normalizeMcpcfAuthType,
  normalizeMcpcfUpstreamAuthType,
} from "../../packages/api/src/server/background/mcpcf/metadata"

describe("MCP Context Forge registry metadata", () => {
  it("derives OAuth auth type from Context Forge oauthEnabled metadata", () => {
    expect(
      normalizeMcpcfAuthType({
        name: "grafana-broker-mcp",
        oauthEnabled: true,
        oauthConfig: {
          authorization_servers: ["https://example.okta.com/oauth2/default"],
          scopes_supported: ["openid", "profile", "email"],
        },
      }),
    ).toBe("oauth")
  })

  it("derives token auth type from disabled OAuth metadata", () => {
    expect(
      normalizeMcpcfAuthType({
        name: "grafana-broker-mcp-token",
        oauthEnabled: false,
        oauthConfig: null,
      }),
    ).toBe("token")
  })

  it("keeps explicit auth type metadata when present", () => {
    expect(
      normalizeMcpcfAuthType({
        auth_type: "Api_Key",
        oauthEnabled: true,
      }),
    ).toBe("api_key")
  })

  it("formats OAuth auth labels with the configured provider", () => {
    expect(formatMcpcfAuthLabel({ authType: "oauth", oauthProviderId: "okta" })).toBe("Okta OAuth")
    expect(formatMcpcfAuthLabel({ authType: "token", oauthProviderId: "okta" })).toBe(
      "MCPCF API token",
    )
  })

  it("derives upstream auth type only from explicit upstream metadata", () => {
    expect(
      normalizeMcpcfUpstreamAuthType({
        name: "firehydrant-broker-mcp-token",
        oauthEnabled: false,
      }),
    ).toBeNull()
    expect(
      normalizeMcpcfUpstreamAuthType({
        upstreamAuthType: "Bearer",
      }),
    ).toBe("token")
    expect(
      normalizeMcpcfUpstreamAuthType({
        upstreamAuth: { credentialType: "api-key" },
      }),
    ).toBe("api_key")
  })

  it("derives human server labels from broker machine names", () => {
    expect(
      getMcpcfServerDisplayLabel({
        id: "server_atlassian",
        slug: "atlassian_broker_mcp",
        label: "atlassian-broker-mcp",
      }),
    ).toBe("Atlassian")
    expect(
      getMcpcfServerDisplayLabel({
        id: "server_google_calendar",
        slug: "google_calendar_broker_mcp",
        label: "google-calendar-broker-mcp",
      }),
    ).toBe("Google Calendar")
    expect(
      getMcpcfServerDisplayLabel({
        id: "server_runbooks",
        label: "ask-o11y-get-runbooks",
      }),
    ).toBe("Ask O11y Get Runbooks")
  })

  it("prefers explicit friendly server labels when present", () => {
    expect(
      getMcpcfServerDisplayLabel({
        id: "server_jira",
        label: "jira-broker-mcp",
        rawMetadata: { displayName: "Jira" },
      }),
    ).toBe("Jira")
  })

  it("uses explicit server descriptions when present", () => {
    expect(
      getMcpcfServerDescription({
        description: "Search Jira and Confluence.",
        tools: [
          {
            name: "atlassian-broker-mcp-jira-list-projects",
            description: "List Jira projects accessible to the authenticated user.",
          },
        ],
      }),
    ).toBe("Search Jira and Confluence.")
  })

  it("derives server descriptions from useful tool descriptions", () => {
    expect(
      getMcpcfServerDescription({
        description: "",
        tools: [
          {
            name: "atlassian-broker-mcp-broker-health",
            description: "Check broker health.",
          },
          {
            name: "atlassian-broker-mcp-jira-list-projects",
            description: "List Jira projects accessible to the authenticated user.",
          },
          {
            name: "atlassian-broker-mcp-jira-create-issue",
            description: "Create a new Jira issue in the specified project.",
          },
        ],
      }),
    ).toBe(
      "Tools include: List Jira projects accessible to the authenticated user; Create a new Jira issue in the specified project.",
    )
  })

  it("returns a clear fallback when no description metadata exists", () => {
    expect(
      getMcpcfServerDescription({
        description: "",
        tools: [{ name: "figma-broker-mcp-broker-capabilities" }],
      }),
    ).toBe(
      "No server description provided by MCP Context Forge. Expand to inspect available tools.",
    )
  })
})
