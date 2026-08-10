import { describe, expect, it } from "vitest"
import {
  buildCustomProviderDrafts,
  buildSharedProviderDrafts,
  getCustomProviderDraftLabel,
  isProviderSettingsDirty,
  serializeProviderFormState,
} from "./provider-drafts"

describe("provider settings drafts", () => {
  it("keeps malformed custom provider records from crashing labels", () => {
    const [draft] = buildCustomProviderDrafts([
      {
        providerId: "legacy-provider",
        models: {},
        hasApiKey: true,
      },
    ])

    expect(getCustomProviderDraftLabel(draft)).toBe("legacy-provider")
  })

  it("detects dirty provider settings when drafts change", () => {
    const shared = buildSharedProviderDrafts(
      [{ providerId: "openai", name: "OpenAI", source: "shared" }],
      [],
    )
    const custom = buildCustomProviderDrafts([])
    const saved = serializeProviderFormState("gpt-4", shared, custom)

    expect(isProviderSettingsDirty(saved, "gpt-4", shared, custom)).toBe(false)
    expect(isProviderSettingsDirty(saved, "gpt-4.1", shared, custom)).toBe(true)
    expect(
      isProviderSettingsDirty(
        saved,
        "gpt-4",
        shared.map((draft) =>
          draft.providerId === "openai" ? { ...draft, enabled: true } : draft,
        ),
        custom,
      ),
    ).toBe(true)
  })

  it("offers vendor-specific personal BYOK slots for Cloudflare AI Gateway", () => {
    const drafts = buildSharedProviderDrafts(
      [
        {
          providerId: "cloudflare-ai-gateway",
          name: "Cloudflare AI Gateway",
          source: "shared",
          credentialSource: "binding",
        },
      ],
      [],
    )

    expect(drafts.map((draft) => draft.providerId)).toEqual([
      "cloudflare-ai-gateway-byok-openai",
      "cloudflare-ai-gateway-byok-anthropic",
      "cloudflare-ai-gateway-byok-xai",
    ])
  })
})
