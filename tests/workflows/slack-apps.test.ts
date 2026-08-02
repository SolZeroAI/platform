import { describe, expect, it } from "vitest"
import { WORKFLOW_TEMPLATES, type WorkflowManifest } from "../../packages/shared/src/workflows"
import {
  buildSlackManifest,
  getSlackTriggerNodes,
  validateWorkflowSlackManifest,
  type NormalizedSlackTriggerNode,
} from "../../packages/api/src/server/background/workflows/slack-apps"

function slackTrigger(override: Partial<NormalizedSlackTriggerNode>): NormalizedSlackTriggerNode {
  return {
    node: {
      id: "slack_event",
      type: "slack-trigger",
      label: "Slack event",
      position: { x: 0, y: 0 },
      options: {},
    },
    surface: "event",
    commandName: null,
    commandDescription: "Run c0 from Slack",
    eventTypes: ["app_mention"],
    channelNamePattern: null,
    keywordRules: [],
    actionIds: [],
    cooldownSeconds: 0,
    dedupeWindowSeconds: 300,
    ...override,
  }
}

function manifestFor(triggers: NormalizedSlackTriggerNode[]) {
  return buildSlackManifest({
    appName: "Incident assistant c0",
    requestUrls: {
      events: "https://c0.test/workflows/slack-apps/wsa_1/events",
      interactions: "https://c0.test/workflows/slack-apps/wsa_1/interactions",
      commands: {
        slack_command: "https://c0.test/workflows/slack-apps/wsa_1/commands/slack_command",
      },
    },
    triggers,
  }) as {
    features: Record<string, unknown>
    oauth_config: { scopes: { bot: string[] } }
    settings: Record<string, unknown>
  }
}

function manifestForWorkflow(workflowManifest: WorkflowManifest) {
  return manifestFor(getSlackTriggerNodes(workflowManifest))
}

describe("workflow Slack app manifests", () => {
  it("omits slash commands when the workflow only has event triggers", () => {
    const manifest = manifestFor([slackTrigger({ surface: "event" })])

    expect(manifest.features.slash_commands).toBeUndefined()
    expect(manifest.oauth_config.scopes.bot).not.toContain("commands")
    expect(manifest.settings.event_subscriptions).toEqual({
      request_url: "https://c0.test/workflows/slack-apps/wsa_1/events",
      bot_events: ["app_mention"],
    })
  })

  it("expands the workflow message shorthand to valid Slack message bot events", () => {
    const manifest = manifestFor([slackTrigger({ eventTypes: ["app_mention", "message"] })])

    expect(manifest.settings.event_subscriptions).toEqual({
      request_url: "https://c0.test/workflows/slack-apps/wsa_1/events",
      bot_events: [
        "app_mention",
        "message.channels",
        "message.groups",
        "message.im",
        "message.mpim",
      ],
    })
  })

  it("adds required scopes for channel lifecycle events", () => {
    const manifest = manifestFor([slackTrigger({ eventTypes: ["channel_created"] })])

    expect(manifest.settings.event_subscriptions).toEqual({
      request_url: "https://c0.test/workflows/slack-apps/wsa_1/events",
      bot_events: ["channel_created"],
    })
    expect(manifest.oauth_config.scopes.bot).toContain("channels:read")
    expect(validateWorkflowSlackManifest(manifest).valid).toBe(true)
  })

  it("includes slash commands only when command triggers are present", () => {
    const manifest = manifestFor([
      slackTrigger({
        node: {
          id: "slack_command",
          type: "slack-trigger",
          label: "Slack command",
          position: { x: 0, y: 0 },
          options: {},
        },
        surface: "command",
        commandName: "/c0",
        eventTypes: [],
      }),
    ])

    expect(manifest.features.slash_commands).toEqual([
      {
        command: "/c0",
        description: "Run c0 from Slack",
        url: "https://c0.test/workflows/slack-apps/wsa_1/commands/slack_command",
        should_escape: false,
      },
    ])
    expect(manifest.oauth_config.scopes.bot).toContain("commands")
    expect(manifest.settings.event_subscriptions).toBeUndefined()
  })

  it("omits interactivity unless interaction triggers are present", () => {
    const eventManifest = manifestFor([slackTrigger({ surface: "event" })])
    const interactionManifest = manifestFor([
      slackTrigger({
        surface: "interaction",
        eventTypes: [],
        actionIds: ["approve_action"],
      }),
    ])

    expect(eventManifest.settings.interactivity).toBeUndefined()
    expect(interactionManifest.settings.interactivity).toEqual({
      is_enabled: true,
      request_url: "https://c0.test/workflows/slack-apps/wsa_1/interactions",
    })
  })

  it("locally rejects known invalid Slack manifest shapes", () => {
    const invalidManifest = manifestFor([slackTrigger({ eventTypes: ["channel_created"] })])
    invalidManifest.features.slash_commands = []
    invalidManifest.settings.event_subscriptions = {
      request_url: "https://c0.test/workflows/slack-apps/wsa_1/events",
      bot_events: ["message", "channel_created"],
    }
    invalidManifest.oauth_config.scopes.bot = ["chat:write"]

    expect(validateWorkflowSlackManifest(invalidManifest)).toEqual({
      valid: false,
      errors: [
        "features.slash_commands must be omitted when there are no slash commands.",
        "settings.event_subscriptions.bot_events cannot include message; use message.channels, message.groups, message.im, or message.mpim.",
        "Event channel_created requires bot scope channels:read.",
      ],
      warnings: [],
    })
  })

  it("generates locally valid manifests for built-in Slack templates", () => {
    const slackTemplates = WORKFLOW_TEMPLATES.filter((template) =>
      template.manifest.nodes.some((node) => node.type === "slack-trigger"),
    )

    expect(slackTemplates.map((template) => template.id)).toEqual([
      "slack-qa-bot",
      "slack-incident-assistant",
    ])
    for (const template of slackTemplates) {
      expect(validateWorkflowSlackManifest(manifestForWorkflow(template.manifest))).toMatchObject({
        valid: true,
        errors: [],
      })
    }
  })
})
