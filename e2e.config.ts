import type { E2EConfig } from "e2e"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { Experimental_DecisionLanguageModel } from "@ai-sdk/provider-utils/experimental-decision"
import { web } from "@e2e-dev/web"
import { github } from "@e2e-dev/github"
import { decisionExecutor, decisionFilter } from "@e2e-dev/decision"
import { appEnvironment } from "./scripts/e2e/environment"

// The suite calls the account's existing default AI Gateway. The token is
// CF_AI_GATEWAY_E2E_TOKEN. This is not the gateway or run token the application
// provisions for a stage. Placeholders let secret-free test collection load
// this module. The gateway has no Clef decision model, so the adapter asks
// gpt-oss-120b on the unified chat route. Harmony rejects reasoning_effort
// "none" and array message content, and its default budget ends in reasoning
// before the JSON answer. Those requests are normalized below.
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || "unconfigured"
const gatewayId = process.env.CF_AI_GATEWAY_E2E_ID || "default"
const gatewayToken = process.env.CF_AI_GATEWAY_E2E_TOKEN || "unconfigured"
const cloudflare = createOpenAICompatible({
  name: "cloudflare-ai-gateway",
  baseURL: `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/v1`,
  apiKey: gatewayToken,
  supportsStructuredOutputs: true,
  headers: {
    "cf-aig-gateway-id": gatewayId,
    "cf-aig-cache-ttl": "3600",
    "cf-aig-skip-cache": process.env.CF_AI_GATEWAY_E2E_SKIP_CACHE === "1" ? "true" : "false",
    "cf-aig-max-attempts": "3",
    "cf-aig-backoff": "exponential",
  },
  transformRequestBody(body: Record<string, unknown>) {
    const request: Record<string, unknown> = {
      ...body,
      reasoning_effort: body.reasoning_effort === "none" ? "low" : body.reasoning_effort,
      // The cache key includes this field. 8192 stored a length finish and an
      // inconclusive verdict. 8193 misses those entries. Later identical
      // requests still cache for the 3600 second TTL.
      max_tokens: body.max_tokens ?? 8193,
    }
    if (!Array.isArray(request.messages)) return request
    return {
      ...request,
      messages: request.messages.map((message: { content?: unknown }) => {
        if (!Array.isArray(message.content)) return message
        let content = message.content
          .map((part: { text?: unknown } | string) => (typeof part === "string" ? part : part.text))
          .filter((text: unknown): text is string => typeof text === "string")
          .join("\n")
        // Action questions say "Goal of this step". Verdicts say "Task of this step".
        // A conditional save sentence activated the selected Overview tab. The direct
        // sentence selected the button. A note that forbade "none" returned invalid JSON.
        const notes = [
          {
            mark: "Goal of this step: Save the changed workflow name",
            text: 'Choose the button named "Save workflow name". If it is not offered, choose done.',
          },
          {
            mark: "Task of this step: Save the changed workflow name",
            text: 'Answer holds when the actions activated the button named "Save workflow name" and that button is absent. That absence is the saved result. Answer fails when the screen shows an error.',
            insert: true,
          },
          {
            mark: "Goal of this step: Set Sub-agents to Disabled and click Update tools.",
            text: 'Choose the combobox named "Sub-agents" while it shows Enabled. When the option named "Disabled" is offered, choose it. Then choose the button named "Update tools". When that dialog is gone, choose done.',
          },
          {
            mark: "Task of this step: Set Sub-agents to Disabled and click Update tools.",
            text: 'Answer holds when the Agent tools dialog is absent after the button named "Update tools" was activated. Answer fails when the screen shows an error.',
            insert: true,
          },
          {
            mark: "Goal of this step: Open the Agent tools editor",
            text: 'Choose the button named "Tools", then the button named "Edit". When the Agent tools dialog is open, choose done.',
          },
          {
            mark: "Task of this step: Open the Agent tools editor",
            text: "Answer holds when the Agent tools dialog is open. Answer fails when the screen shows an error.",
            insert: true,
          },
          {
            mark: "Goal of this step: Create the supplied bot from the completed form.",
            text: 'Choose the button named "Create bot". When the page heading shows the supplied bot name, choose done.',
          },
          {
            mark: "Task of this step: Create the supplied bot from the completed form.",
            text: "Answer holds when the page heading shows the supplied bot name. Answer fails when the screen shows an error.",
            insert: true,
          },
          {
            mark: "Goal of this step: Turn off the Enable switch for the supplied skill.",
            text: 'Choose the checked switch whose name is Enable followed by the supplied skill name. When the button named "Use admin default" is visible beside that skill, choose done, and leave that button untouched.',
          },
          {
            mark: "Task of this step: Turn off the Enable switch for the supplied skill.",
            text: 'Answer holds when the Enable switch for the supplied skill is off and the button named "Use admin default" is visible. Answer fails when the screen shows an error.',
            insert: true,
          },
        ] as const
        for (const note of notes) {
          if (!content.includes(note.mark)) continue
          const sentence = `\n\n${note.text}`
          content =
            "insert" in note && note.insert
              ? content.replace(note.mark, `${note.mark}${sentence}`)
              : content + sentence
        }
        return { ...message, content }
      }),
    }
  },
})
const languageModel = cloudflare.chatModel("@cf/openai/gpt-oss-120b")
const decisionModel = new Experimental_DecisionLanguageModel({ model: languageModel })

export default {
  projectId: "solzero",
  tests: ["tests/**/*.e2e.ts", "!tests/lifecycle/**"],
  targets: [
    {
      name: "local-cloudflare",
      engine: web({ permissions: ["clipboard-read", "clipboard-write"] }),
      app: {
        url: "http://localhost:3000",
        environment: "test",
        command: {
          executable: "nub",
          args: ["exec", "tsx", "scripts/e2e/dev.ts"],
          env: appEnvironment,
          startupTimeout: process.env.E2E_CONTAINER_RUNTIME === "1" ? 600_000 : 180_000,
          shutdownTimeout: 120_000,
          log: ".e2e/logs/stack.log",
        },
      },
    },
  ],
  agents: {
    default: {
      executor: decisionExecutor({ model: decisionModel, textModel: languageModel }),
      maxModelCalls: 20,
      maxSteps: 20,
      context:
        "SolZero test deployment. Only disposable e2e accounts and records are allowed. Do not link real integrations or submit external messages. Use the exact input values supplied in params. Wait for each page before acting.",
    },
  },
  credentials: {
    admin: {
      username: process.env.E2E_USER_ADMIN_USERNAME!,
      password: () => process.env.E2E_USER_ADMIN_PASSWORD!,
    },
    ...(process.env.E2E_OIDC_USERNAME
      ? {
          oidcMember: {
            username: process.env.E2E_OIDC_USERNAME,
            password: () => process.env.E2E_OIDC_PASSWORD ?? "",
          },
        }
      : {}),
    peer: {
      username: process.env.E2E_USER_PEER_USERNAME!,
      password: () => process.env.E2E_USER_PEER_PASSWORD!,
    },
  },
  secrets: {
    gateway: () => process.env.CF_AI_GATEWAY_E2E_TOKEN ?? "",
    fixture: () => process.env.E2E_FIXTURE_SECRET ?? "disposable-e2e-value",
    ...(process.env.E2E_BYOK_API_KEY ? { byok: process.env.E2E_BYOK_API_KEY } : {}),
  },
  filters: [decisionFilter({ model: decisionModel })],
  workers: 1,
  retries: 0,
  timeout: 180_000,
  assertionTimeout: 20_000,
  cache: { mode: "read-write", dir: process.env.E2E_ACTION_CACHE_DIR ?? ".e2e/cache" },
  reporters: ["list", "junit", "markdown", github({ key: "solzero-core" })],
  trace: "off",
  failOnSkippedFailure: true,
} satisfies E2EConfig
