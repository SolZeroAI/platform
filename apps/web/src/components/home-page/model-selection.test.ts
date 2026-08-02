import { describe, expect, it } from "vitest"
import type { RuntimeProviderCatalog } from "@c0-agent/shared"
import { getDefaultVisibleModel } from "./model-selection"

const catalog: Pick<RuntimeProviderCatalog, "defaultModel" | "modelOptions"> = {
  defaultModel: "openai/gpt-5.5",
  modelOptions: [
    {
      category: "OpenAI",
      providerId: "openai",
      models: [
        {
          id: "openai/gpt-5.5",
          providerId: "openai",
          providerName: "OpenAI",
          modelId: "gpt-5.5",
          name: "gpt-5.5",
          description: "",
        },
      ],
    },
  ],
}

describe("getDefaultVisibleModel", () => {
  it("returns the configured default when it is visible", () => {
    expect(getDefaultVisibleModel(catalog)).toBe("openai/gpt-5.5")
  })

  it("returns an empty selection when there is no configured default", () => {
    expect(getDefaultVisibleModel({ ...catalog, defaultModel: null })).toBe("")
  })

  it("returns an empty selection when the configured default is not visible", () => {
    expect(getDefaultVisibleModel({ ...catalog, defaultModel: "openai/removed" })).toBe("")
  })
})
