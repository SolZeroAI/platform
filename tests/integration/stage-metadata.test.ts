import { describe, expect, it } from "vitest"
import {
  getStageMetadataFromConfigSync,
  getStageMetadataSync,
} from "../../packages/shared/src/stageMetadata"
import { loadS0ConfigFile, REPO_ROOT } from "../../packages/infra/src/stacks/runtime"
import {
  compiledStageEnv,
  TEST_APPLICATION_CONFIG,
  TEST_DEPLOYMENT_CONFIG,
} from "../fixtures/stage-metadata"

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
    expect(getStageMetadataSync("dev").infra.alchemyStateStore).toBe("local")
    expect(getStageMetadataSync("test").infra.alchemyStateStore).toBe("local")
    expect(
      getStageMetadataFromConfigSync("dev", TEST_DEPLOYMENT_CONFIG, TEST_APPLICATION_CONFIG).infra
        .alchemyStateStore,
    ).toBe("local")
  })

  it("keeps Alchemy resource graph in Cloudflare.state for deployed stages", () => {
    expect(getStageMetadataSync(compiledStageEnv("pre")).infra.alchemyStateStore).toBe("cloudflare")
    expect(getStageMetadataSync(compiledStageEnv("pre-42")).infra.alchemyStateStore).toBe(
      "cloudflare",
    )
    expect(getStageMetadataSync(compiledStageEnv("prod")).infra.alchemyStateStore).toBe(
      "cloudflare",
    )
    expect(
      getStageMetadataFromConfigSync("prod", TEST_DEPLOYMENT_CONFIG, TEST_APPLICATION_CONFIG).infra
        .alchemyStateStore,
    ).toBe("cloudflare")
  })

  it("reads alchemyStateStore from constructed repo stage metadata", () => {
    const local = loadS0ConfigFile(REPO_ROOT, "dev")
    const test = loadS0ConfigFile(REPO_ROOT, "test")
    const preview = loadS0ConfigFile(REPO_ROOT, "pre")
    const production = loadS0ConfigFile(REPO_ROOT, "prod")

    expect(
      getStageMetadataFromConfigSync("dev", local.deployment, local.application).infra
        .alchemyStateStore,
    ).toBe("local")
    expect(
      getStageMetadataFromConfigSync("test", test.deployment, test.application).infra
        .alchemyStateStore,
    ).toBe("local")
    expect(
      getStageMetadataFromConfigSync("pre", preview.deployment, preview.application).infra
        .alchemyStateStore,
    ).toBe("cloudflare")
    expect(
      getStageMetadataFromConfigSync("prod", production.deployment, production.application).infra
        .alchemyStateStore,
    ).toBe("cloudflare")
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
