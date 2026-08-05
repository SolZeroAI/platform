import { describe, expect, it } from "vitest"
import type { ApiEnv } from "infra/types/env"
import { handleGitHubAppWebhookRequest } from "../../packages/api/src/server/background/auth/github-webhook"

function createEnv(): ApiEnv {
  return {
    GITHUB_APP_ID: "12345",
    GITHUB_APP_CLIENT_ID: "Iv1.test",
    GITHUB_APP_CLIENT_SECRET: "client-secret",
    GITHUB_APP_PRIVATE_KEY: "unused-for-webhook-test",
    GITHUB_APP_SLUG: "s0-test",
    GITHUB_APP_WEBHOOK_SECRET: "webhook-secret",
  } as ApiEnv
}

describe("GitHub App webhook", () => {
  it("rejects invalid webhook signatures", async () => {
    const response = await handleGitHubAppWebhookRequest(
      new Request("http://localhost/github/webhook", {
        method: "POST",
        headers: {
          "x-github-delivery": "delivery-1",
          "x-github-event": "installation",
          "x-hub-signature-256": "sha256=deadbeef",
        },
        body: JSON.stringify({ sender: { id: 12345 } }),
      }),
      createEnv(),
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid GitHub webhook signature",
    })
  })
})
