import type { E2EConfig } from "e2e"
import { web } from "@e2e-dev/web"
import { appEnvironment } from "./scripts/e2e/environment"
import { createClefExecutor } from "./scripts/e2e/cf-clef-executor"

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
          startupTimeout: 180_000,
          shutdownTimeout: 30_000,
          log: ".e2e/logs/stack.log",
        },
      },
    },
  ],
  agents: {
    default: {
      executor: createClefExecutor(),
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
  workers: 1,
  retries: 0,
  timeout: 180_000,
  assertionTimeout: 20_000,
  cache: { mode: "read-write" },
  reporters: ["list", "junit", "markdown"],
  trace: "retain-on-failure",
  failOnSkippedFailure: true,
} satisfies E2EConfig
