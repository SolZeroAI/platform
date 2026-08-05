import * as Effect from "effect/Effect"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { handleWorkflowSlackAppRequest } from "../../packages/api/src/server/background/workflows/slack-public-router"
import type { Env } from "../../packages/api/src/server/background/types"
import type { WorkflowRecord } from "../../packages/api/src/server/background/db/workflows"

const startWorkflowRun = vi.fn()
const getWorkflowSlackAppSecrets = vi.fn()
const getLinkedUserIdByProviderAccountId = vi.fn()
const fetchMock = vi.fn()
const deliveries = new Map<
  string,
  { id: string; run_id: string | null; status: string; created_at: number; updated_at: number }
>()
let workflowStatus: WorkflowRecord["status"] = "active"

const appRecord = {
  id: "wsa_1",
  workflow_id: "wf_1",
  user_id: "user_1",
  app_name: "Workflow s0",
  signing_secret_key: "workflow_slack_apps_wsa_1_signing_secret",
  bot_token_secret_key: "workflow_slack_apps_wsa_1_bot_token",
  created_at: 1,
  updated_at: 1,
}

const eventRegistration = {
  id: "wstr_1",
  slack_app_id: "wsa_1",
  workflow_id: "wf_1",
  workflow_version: 1,
  node_id: "slack_event",
  surface: "event" as const,
  command_name: null,
  event_types_json: JSON.stringify(["app_mention"]),
  channel_name_pattern: "incident",
  keyword_rules_json: "[]",
  action_ids_json: "[]",
  cooldown_seconds: 0,
  dedupe_window_seconds: 300,
  enabled: true,
  created_at: 1,
  updated_at: 1,
}

vi.mock("../../packages/api/src/server/background/workflows/slack-apps", () => ({
  getWorkflowSlackAppSecrets: (...args: unknown[]) => getWorkflowSlackAppSecrets(...args),
  parseSlackRegistrationStringArray(value: string) {
    return JSON.parse(value) as string[]
  },
}))

vi.mock("../../packages/api/src/server/lib/better-auth", () => ({
  getLinkedUserIdByProviderAccountId: (...args: unknown[]) =>
    getLinkedUserIdByProviderAccountId(...args),
}))

vi.mock("../../packages/api/src/server/background/db/workflow-slack-apps", () => {
  class WorkflowSlackAppStore {
    async getAppById(id: string) {
      return id === appRecord.id ? appRecord : null
    }

    async listEnabledRegistrationsForApp() {
      return [eventRegistration]
    }

    async createDeliveryIfAbsent(input: {
      id: string
      deliveryKey: string
      dedupeWindowSeconds: number
      now: number
    }) {
      const existing = deliveries.get(input.deliveryKey)
      if (existing) {
        const duplicateWindowActive =
          input.dedupeWindowSeconds > 0 &&
          existing.created_at >= input.now - input.dedupeWindowSeconds * 1000
        if (!duplicateWindowActive) {
          const refreshed = {
            ...existing,
            run_id: null,
            status: "received",
            created_at: input.now,
            updated_at: input.now,
          }
          deliveries.set(input.deliveryKey, refreshed)
          return {
            created: true,
            delivery: {
              ...refreshed,
              slack_app_id: "wsa_1",
              workflow_id: "wf_1",
              node_id: "slack_event",
              delivery_key: input.deliveryKey,
              surface: "event",
              error: null,
            },
          }
        }
        return {
          created: false,
          delivery: {
            ...existing,
            slack_app_id: "wsa_1",
            workflow_id: "wf_1",
            node_id: "slack_event",
            delivery_key: input.deliveryKey,
            surface: "event",
            error: null,
          },
        }
      }
      const delivery = {
        id: input.id,
        run_id: null,
        status: "received",
        created_at: input.now,
        updated_at: input.now,
      }
      deliveries.set(input.deliveryKey, delivery)
      return {
        created: true,
        delivery: {
          ...delivery,
          slack_app_id: "wsa_1",
          workflow_id: "wf_1",
          node_id: "slack_event",
          delivery_key: input.deliveryKey,
          surface: "event",
          error: null,
        },
      }
    }

    async updateDelivery(input: { id: string; runId?: string | null; status: string }) {
      for (const delivery of deliveries.values()) {
        if (delivery.id === input.id) {
          delivery.run_id = input.runId ?? null
          delivery.status = input.status
          delivery.updated_at = Date.now()
        }
      }
    }

    async getRecentDeliveryForNode() {
      return null
    }
  }

  return {
    WorkflowSlackAppStore,
    createWorkflowSlackAppStoreFromD1: () => new WorkflowSlackAppStore(),
  }
})

vi.mock("../../packages/api/src/server/background/db/workflows", () => {
  class WorkflowStore {
    async getWorkflow() {
      return {
        id: "wf_1",
        user_id: "user_1",
        name: "Slack workflow",
        status: workflowStatus,
        manifest_version: 1,
        manifest_key: "manifest.json",
        code_key: "workflow.js",
        webhook_id: "wh_1",
        created_at: 1,
        updated_at: 1,
      } satisfies WorkflowRecord
    }
  }

  return {
    WorkflowStore,
    createWorkflowStoreFromD1: () => new WorkflowStore(),
  }
})

vi.mock("../../packages/api/src/server/background/workflows/lifecycle", () => ({
  WorkflowLifecycle: class {
    startWorkflowRun(input: unknown) {
      return Effect.tryPromise({ try: () => startWorkflowRun(input), catch: (cause) => cause })
    }
  },
}))

async function signSlackBody(body: string, secret: string, timestamp: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`v0:${timestamp}:${body}`))
  return `v0=${Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`
}

async function signedSlackRequest(path: string, body: string, secret = "signing-secret") {
  const timestamp = String(Math.floor(Date.now() / 1000))
  return new Request(`https://s0.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": await signSlackBody(body, secret, timestamp),
    },
    body,
  })
}

describe("workflow Slack app public router", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock)
    fetchMock.mockReset()
    deliveries.clear()
    workflowStatus = "active"
    eventRegistration.event_types_json = JSON.stringify(["app_mention"])
    eventRegistration.channel_name_pattern = "incident"
    eventRegistration.cooldown_seconds = 0
    eventRegistration.dedupe_window_seconds = 300
    startWorkflowRun.mockReset()
    startWorkflowRun.mockResolvedValue({ id: "wfr_1", status: "running" })
    getWorkflowSlackAppSecrets.mockReset()
    getWorkflowSlackAppSecrets.mockReturnValue(
      Effect.succeed({ signingSecret: "signing-secret", botToken: null }),
    )
    getLinkedUserIdByProviderAccountId.mockReset()
    getLinkedUserIdByProviderAccountId.mockReturnValue(Effect.succeed("linked_user_1"))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("handles Slack URL verification after per-app signature verification", async () => {
    const response = await handleWorkflowSlackAppRequest(
      await signedSlackRequest(
        "/workflows/slack-apps/wsa_1/events",
        JSON.stringify({ type: "url_verification", challenge: "challenge-value" }),
      ),
      {} as Env,
    )

    await expect(response?.json()).resolves.toEqual({ challenge: "challenge-value" })
    expect(startWorkflowRun).not.toHaveBeenCalled()
  })

  it("starts matching Slack trigger nodes once and dedupes Slack retries", async () => {
    const body = JSON.stringify({
      type: "event_callback",
      team_id: "T1",
      event_id: "Ev1",
      event: {
        type: "app_mention",
        user: "U1",
        channel: { id: "D1", name: "incident-dm" },
        channel_type: "im",
        text: "<@BOT> which deploy preceded this?",
        ts: "123.456",
      },
    })

    const first = await handleWorkflowSlackAppRequest(
      await signedSlackRequest("/workflows/slack-apps/wsa_1/events", body),
      {} as Env,
    )
    const second = await handleWorkflowSlackAppRequest(
      await signedSlackRequest("/workflows/slack-apps/wsa_1/events", body),
      {} as Env,
    )

    expect(first?.status).toBe(200)
    expect(second?.status).toBe(200)
    expect(startWorkflowRun).toHaveBeenCalledTimes(1)
    expect(getLinkedUserIdByProviderAccountId).toHaveBeenCalledWith({}, "slack", "U1")
    expect(startWorkflowRun).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "linked_user_1",
        oktaUserId: null,
        trigger: expect.objectContaining({
          kind: "slack",
          nodeId: "slack_event",
          payload: expect.objectContaining({
            channelId: "D1",
            channelName: "incident-dm",
            userId: "U1",
            eventType: "app_mention",
            responseUrl: null,
          }),
        }),
      }),
    )
  })

  it("starts another run when a matching Slack delivery key is outside the dedupe window", async () => {
    const body = JSON.stringify({
      type: "event_callback",
      team_id: "T1",
      event_id: "Ev-window",
      event: {
        type: "app_mention",
        user: "U1",
        channel: { id: "C1", name: "incident-api" },
        text: "<@BOT> which deploy preceded this?",
        ts: "123.456",
      },
    })

    await handleWorkflowSlackAppRequest(
      await signedSlackRequest("/workflows/slack-apps/wsa_1/events", body),
      {} as Env,
    )
    const firstDelivery = deliveries.get("Ev-window")
    expect(firstDelivery).toBeDefined()
    firstDelivery!.created_at -= (eventRegistration.dedupe_window_seconds + 1) * 1000

    const second = await handleWorkflowSlackAppRequest(
      await signedSlackRequest("/workflows/slack-apps/wsa_1/events", body),
      {} as Env,
    )

    expect(second?.status).toBe(200)
    expect(startWorkflowRun).toHaveBeenCalledTimes(2)
  })

  it("does not dedupe Slack deliveries when the dedupe window is disabled", async () => {
    eventRegistration.dedupe_window_seconds = 0
    const body = JSON.stringify({
      type: "event_callback",
      team_id: "T1",
      event_id: "Ev-no-window",
      event: {
        type: "app_mention",
        user: "U1",
        channel: { id: "C1", name: "incident-api" },
        text: "<@BOT> which deploy preceded this?",
        ts: "123.456",
      },
    })

    await handleWorkflowSlackAppRequest(
      await signedSlackRequest("/workflows/slack-apps/wsa_1/events", body),
      {} as Env,
    )
    const second = await handleWorkflowSlackAppRequest(
      await signedSlackRequest("/workflows/slack-apps/wsa_1/events", body),
      {} as Env,
    )

    expect(second?.status).toBe(200)
    expect(startWorkflowRun).toHaveBeenCalledTimes(2)
  })

  it("matches Slack message subscription types against delivered message events in public channels as workflow owner", async () => {
    eventRegistration.event_types_json = JSON.stringify(["message.channels"])
    eventRegistration.channel_name_pattern = "incident"
    const body = JSON.stringify({
      type: "event_callback",
      team_id: "T1",
      event_id: "EvMessage1",
      event: {
        type: "message",
        channel_type: "channel",
        user: "U1",
        channel: { id: "C1", name: "incident-api" },
        text: "latency is elevated",
        ts: "123.456",
      },
    })

    const response = await handleWorkflowSlackAppRequest(
      await signedSlackRequest("/workflows/slack-apps/wsa_1/events", body),
      {} as Env,
    )

    expect(response?.status).toBe(200)
    expect(getLinkedUserIdByProviderAccountId).not.toHaveBeenCalled()
    expect(startWorkflowRun).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_1",
        oktaUserId: null,
        trigger: expect.objectContaining({
          kind: "slack",
          nodeId: "slack_event",
          payload: expect.objectContaining({
            eventType: "message",
            text: "latency is elevated",
          }),
        }),
      }),
    )
  })

  it("hydrates Slack event channel names before channel-pattern matching", async () => {
    eventRegistration.event_types_json = JSON.stringify(["message.channels"])
    eventRegistration.channel_name_pattern = "incident"
    getWorkflowSlackAppSecrets.mockReturnValue(
      Effect.succeed({ signingSecret: "signing-secret", botToken: "xoxb-test" }),
    )
    fetchMock.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input : input.url,
      )
      if (
        init?.method === "GET" &&
        url.pathname === "/api/conversations.info" &&
        url.searchParams.get("channel") === "C1"
      ) {
        return Response.json({ ok: true, channel: { id: "C1", name: "incident-api" } })
      }
      return Response.json({ ok: false, error: "invalid_arguments" })
    })
    const body = JSON.stringify({
      type: "event_callback",
      team_id: "T1",
      event_id: "EvHydrateChannelName",
      event: {
        type: "message",
        channel_type: "channel",
        user: "U1",
        channel: "C1",
        text: "latency is elevated",
        ts: "123.456",
      },
    })

    const response = await handleWorkflowSlackAppRequest(
      await signedSlackRequest("/workflows/slack-apps/wsa_1/events", body),
      {} as Env,
    )

    expect(response?.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith(
      "https://slack.com/api/conversations.info?channel=C1",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer xoxb-test" }),
      }),
    )
    expect(startWorkflowRun).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_1",
        trigger: expect.objectContaining({
          kind: "slack",
          nodeId: "slack_event",
          payload: expect.objectContaining({
            channelId: "C1",
            channelName: "incident-api",
            eventType: "message",
          }),
        }),
      }),
    )
  })

  it("rejects invalid signatures before matching triggers", async () => {
    const response = await handleWorkflowSlackAppRequest(
      await signedSlackRequest(
        "/workflows/slack-apps/wsa_1/events",
        JSON.stringify({ type: "url_verification", challenge: "challenge-value" }),
        "wrong-secret",
      ),
      {} as Env,
    )

    expect(response?.status).toBe(401)
    expect(startWorkflowRun).not.toHaveBeenCalled()
  })

  it("returns a setup URL instead of starting responder-triggered workflows for unlinked Slack users in DMs", async () => {
    getLinkedUserIdByProviderAccountId.mockReturnValue(Effect.succeed(null))
    const body = JSON.stringify({
      type: "event_callback",
      team_id: "T1",
      event_id: "Ev-unlinked",
      event: {
        type: "app_mention",
        user: "U1",
        channel: { id: "D1", name: "incident-dm" },
        channel_type: "im",
        text: "<@BOT> help",
        ts: "123.456",
      },
    })

    const response = await handleWorkflowSlackAppRequest(
      await signedSlackRequest("/workflows/slack-apps/wsa_1/events", body),
      { STAGE: "dev" } as Env,
    )

    expect(response?.status).toBe(200)
    await expect(response?.json()).resolves.toMatchObject({
      ok: true,
      error: "Slack user is not linked to a SolZero account",
      setupUrl: "http://localhost:3000/settings?slackUserId=U1",
      slackUserId: "U1",
      runs: [
        {
          workflowId: "wf_1",
          nodeId: "slack_event",
          status: "setup_required",
        },
      ],
    })
    expect(startWorkflowRun).not.toHaveBeenCalled()
  })

  it("runs public channel app_mention and message triggers as workflow owner even if Slack user is unlinked", async () => {
    getLinkedUserIdByProviderAccountId.mockReturnValue(
      Effect.fail(new Error("linked lookup must not be called for public channel events")),
    )
    const body = JSON.stringify({
      type: "event_callback",
      team_id: "T1",
      event_id: "Ev-public-mention",
      event: {
        type: "app_mention",
        user: "U1",
        channel: { id: "C1", name: "incident-api" },
        channel_type: "channel",
        text: "<@BOT> status?",
        ts: "123.456",
      },
    })

    const response = await handleWorkflowSlackAppRequest(
      await signedSlackRequest("/workflows/slack-apps/wsa_1/events", body),
      {} as Env,
    )

    expect(response?.status).toBe(200)
    expect(getLinkedUserIdByProviderAccountId).not.toHaveBeenCalled()
    expect(startWorkflowRun).toHaveBeenCalledTimes(1)
    expect(startWorkflowRun).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_1",
        trigger: expect.objectContaining({
          kind: "slack",
          nodeId: "slack_event",
          payload: expect.objectContaining({ eventType: "app_mention" }),
        }),
      }),
    )
  })

  it("uses workflow owner identity for autonomous channel-created triggers", async () => {
    eventRegistration.event_types_json = JSON.stringify(["channel_created"])
    getLinkedUserIdByProviderAccountId.mockReturnValue(
      Effect.fail(new Error("linked user lookup should not run")),
    )
    const body = JSON.stringify({
      type: "event_callback",
      team_id: "T1",
      event_id: "Ev-channel-created",
      event: {
        type: "channel_created",
        channel: { id: "C1", name: "incident-api", creator: "Ucreator" },
        event_ts: "123.456",
      },
    })

    const response = await handleWorkflowSlackAppRequest(
      await signedSlackRequest("/workflows/slack-apps/wsa_1/events", body),
      {} as Env,
    )

    expect(response?.status).toBe(200)
    expect(getLinkedUserIdByProviderAccountId).not.toHaveBeenCalled()
    expect(startWorkflowRun).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_1",
        oktaUserId: null,
        trigger: expect.objectContaining({
          kind: "slack",
          nodeId: "slack_event",
          payload: expect.objectContaining({
            eventType: "channel_created",
            userId: "Ucreator",
          }),
        }),
      }),
    )
  })

  it("records ignored deliveries for disabled workflows", async () => {
    workflowStatus = "disabled"
    const body = JSON.stringify({
      type: "event_callback",
      team_id: "T1",
      event_id: "Ev-disabled",
      event: {
        type: "app_mention",
        user: "U1",
        channel: { id: "C1", name: "incident-api" },
        text: "help",
        ts: "123.456",
      },
    })

    const response = await handleWorkflowSlackAppRequest(
      await signedSlackRequest("/workflows/slack-apps/wsa_1/events", body),
      {} as Env,
    )

    await expect(response?.json()).resolves.toMatchObject({
      ok: true,
      runs: [{ workflowId: "wf_1", nodeId: "slack_event", status: "ignored" }],
    })
    expect(startWorkflowRun).not.toHaveBeenCalled()
  })
})
