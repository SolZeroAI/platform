import type { E2EConfig } from "e2e"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { web } from "@e2e-dev/web"
import { github } from "@e2e-dev/github"
import { decisionExecutor, decisionFilter } from "@e2e-dev/decision"
import { clefDecisionModel } from "./scripts/e2e/clef-decision-model"
import { appEnvironment } from "./scripts/e2e/environment"

// The suite calls the account's existing default AI Gateway. The token is
// CF_AI_GATEWAY_E2E_TOKEN. This is not the gateway or run token the application
// provisions for a stage. Placeholders let secret-free test collection load
// this module.
//
// Cloudflare Clef answers the decision questions: agent.act actions,
// agent.assert verdicts and the affected-test filter. gpt-oss-120b on the
// unified chat route answers the text questions: agent.waitFor and
// agent.extract. Harmony rejects reasoning_effort "none" and array message
// content, and its default budget ends in reasoning before the JSON answer.
// Those requests are normalized below.
//
// Gateway response caching stays off. It stores any 200 body, including an
// answer the runner rejects, and replays it to the retry and to every CI run
// inside the TTL. Verified e2e action replay in .e2e/cache is the only cache,
// because it records a step only after the step passes.
const decisionModelId = "@cf/cloudflare/clef"
const languageModelId = "@cf/openai/gpt-oss-120b"
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
    "cf-aig-skip-cache": "true",
    "cf-aig-max-attempts": "3",
    "cf-aig-backoff": "exponential",
  },
  transformRequestBody(body: Record<string, unknown>) {
    // oxlint-disable-next-line anti-slop/no-known-value-widening -- request copies the model body, whose keys are dynamic, then overrides reasoning_effort and max_tokens.
    const request: Record<string, unknown> = {
      ...body,
      reasoning_effort: body.reasoning_effort === "none" ? "low" : body.reasoning_effort,
      max_tokens: body.max_tokens ?? 8192,
    }

    if (!Array.isArray(request.messages)) return request

    return {
      ...request,
      messages: request.messages.map((message: { content?: unknown }) => {
        if (!Array.isArray(message.content)) return message

        const content = message.content
          .map((part: { text?: unknown } | string) => (typeof part === "string" ? part : part.text))
          .filter((text: unknown): text is string => typeof text === "string")
          .join("\n")

        return { ...message, content }
      }),
    }
  },
})

const languageModel = cloudflare.chatModel(languageModelId)

const decisionModel = clefDecisionModel({
  modelId: decisionModelId,
  accountId,
  gatewayId,
  token: gatewayToken,
})

const credentials = {
  admin: {
    username: process.env.E2E_USER_ADMIN_USERNAME!,
    password: () => process.env.E2E_USER_ADMIN_PASSWORD!,
  },
  peer: {
    username: process.env.E2E_USER_PEER_USERNAME!,
    password: () => process.env.E2E_USER_PEER_PASSWORD!,
  },
}

if (process.env.E2E_OIDC_USERNAME) {
  Object.assign(credentials, {
    oidcMember: {
      username: process.env.E2E_OIDC_USERNAME,
      password: () => process.env.E2E_OIDC_PASSWORD ?? "",
    },
  })
}

const secrets = {
  gateway: () => process.env.CF_AI_GATEWAY_E2E_TOKEN ?? "",
  fixture: () => process.env.E2E_FIXTURE_SECRET ?? "disposable-e2e-value",
}

if (process.env.E2E_BYOK_API_KEY) {
  Object.assign(secrets, { byok: process.env.E2E_BYOK_API_KEY })
}

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
  credentials,
  secrets,
  filters: [decisionFilter({ model: decisionModel })],
  workers: 1,
  // A second attempt asks the models again, because the gateway does not cache
  // responses.
  retries: 1,
  timeout: 180_000,
  assertionTimeout: 20_000,
  cache: { mode: "read-write", dir: process.env.E2E_ACTION_CACHE_DIR ?? ".e2e/cache" },
  reporters: ["list", "junit", "markdown", github({ key: "solzero-core" })],
  trace: "off",
  failOnSkippedFailure: true,
} satisfies E2EConfig
