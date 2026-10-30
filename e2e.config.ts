import type { E2EConfig } from "e2e"
import { web } from "@e2e-dev/web"
import { github } from "@e2e-dev/github"
import { decisionExecutor, decisionFilter } from "@e2e-dev/decision"
import { appEnvironment } from "./scripts/e2e/environment"
import { e2eModels } from "./scripts/e2e/models"

// The suite calls the account's existing default AI Gateway. The token is
// CF_AI_GATEWAY_E2E_TOKEN. This is not the gateway or run token the application
// provisions for a stage. Placeholders let secret-free test collection load
// this module. scripts/e2e/models.ts selects the models.
const { decisionModel, languageModel } = e2eModels({
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID || "unconfigured",
  gatewayId: process.env.CF_AI_GATEWAY_E2E_ID || "default",
  token: process.env.CF_AI_GATEWAY_E2E_TOKEN || "unconfigured",
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
  tests: "tests/**/*.e2e.ts",
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
