import { describe, expect, it } from "vitest"
import {
  getAlchemyStateStoreKind,
  getStageMetadataSync,
} from "../../packages/shared/src/stageMetadata"
import { compiledStageEnv, TEST_APPLICATION_CONFIG } from "../fixtures/stage-metadata"

describe("stage Slack notification metadata", () => {
  it("keeps Slack notifications disabled without deployment configuration", () => {
    const metadata = getStageMetadataSync(compiledStageEnv("pre"))

    expect(metadata.app.sendSlackNotifications).toBe(false)
    expect(metadata.app.slackChannel).toBe("")
  })

  it("enables Slack notifications only with an explicit channel", () => {
    const metadata = getStageMetadataSync(
      compiledStageEnv("prod", undefined, {
        ...TEST_APPLICATION_CONFIG,
        sendSlackNotifications: true,
        slackChannel: "s0-alerts",
      }),
    )

    expect(metadata.app.sendSlackNotifications).toBe(true)
    expect(metadata.app.slackChannel).toBe("s0-alerts")
  })

  it("keeps Alchemy resource graph on disk for local stages", () => {
    expect(getAlchemyStateStoreKind("dev")).toBe("local")
    expect(getAlchemyStateStoreKind("test")).toBe("local")
    expect(getStageMetadataSync("dev").infra.alchemyStateStore).toBe("local")
    expect(getStageMetadataSync("test").infra.alchemyStateStore).toBe("local")
  })

  it("keeps Alchemy resource graph in Cloudflare.state for deployed stages", () => {
    expect(getAlchemyStateStoreKind("pre")).toBe("cloudflare")
    expect(getAlchemyStateStoreKind("pre-42")).toBe("cloudflare")
    expect(getAlchemyStateStoreKind("prod")).toBe("cloudflare")
    expect(getStageMetadataSync(compiledStageEnv("pre")).infra.alchemyStateStore).toBe("cloudflare")
    expect(getStageMetadataSync(compiledStageEnv("prod")).infra.alchemyStateStore).toBe("cloudflare")
  })

  it("does not send Slack notifications when the channel is omitted", () => {
    const metadata = getStageMetadataSync(
      compiledStageEnv("prod", undefined, {
        ...TEST_APPLICATION_CONFIG,
        sendSlackNotifications: true,
        slackChannel: "",
      }),
    )

    expect(metadata.app.sendSlackNotifications).toBe(false)
    expect(metadata.app.slackChannel).toBe("")
  })
})
