import { test } from "@e2e-dev/web"
import { expect } from "e2e"
import type { ProviderSettingsPayload } from "../packages/api/src/http/schemas/providers"
import { api, uniqueName } from "./support/api"
import { requireFixture } from "./support/external-fixtures"

test(
  "personal BYOK provider persists and executes a real isolate prompt",
  { session: "admin", tags: ["external", "byok"] },
  async ({ app, browser, screen }) => {
    const baseURL = requireFixture("E2E_BYOK_BASE_URL")
    const model = requireFixture("E2E_BYOK_MODEL")
    const apiKey = requireFixture("E2E_BYOK_API_KEY")
    const providerId = uniqueName("e2e-provider")
    const original = await api<{ settings: ProviderSettingsPayload }>(browser, "/providers")
    let sessionId: string | undefined
    try {
      const configured = await api<{
        catalog: { providers: Array<{ providerId: string; hasApiKey: boolean }> }
      }>(browser, "/providers", "PUT", {
        ...original.settings,
        customProviders: [
          ...original.settings.customProviders,
          {
            providerId,
            name: providerId,
            npm: "@ai-sdk/openai-compatible",
            options: { baseURL },
            apiKey,
            models: { [model]: { name: model, provider: { api: "chat_completions" } } },
          },
        ],
      })
      expect(
        configured.catalog.providers.find((item) => item.providerId === providerId)?.hasApiKey,
      ).toBe(true)
      await app.open("/settings?category=providers")
      await expect(screen.getByText(providerId, { exact: true }).first()).toBeVisible()
      const marker = uniqueName("byok-output")
      const result = await api<{
        sessionId: string
        status: string
        output: string
        error?: string
      }>(browser, "/sessions/run", "POST", {
        title: uniqueName("e2e-byok"),
        agentRuntime: "isolate",
        model: `${providerId}/${model}`,
        content: `Reply with only ${marker}. Do not call external tools.`,
      })
      sessionId = result.sessionId
      expect(result.status, result.error).toBe("completed")
      expect(result.output).toContain(marker)
    } finally {
      if (sessionId) await api(browser, `/sessions/${sessionId}`, "DELETE")
      await api(browser, "/providers", "PUT", original.settings)
    }
  },
)
